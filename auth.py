"""
auth.py — Authentication primitives for Foundry.

Responsibilities:
    - Hash + verify passwords (bcrypt)
    - Issue + verify JWT tokens
    - Create + update + look up users in SQLite via db.*
    - FastAPI dependencies that inject the current user / require admin

Configuration is env-driven now (no YAML invitation list):
    FOUNDRY_JWT_SECRET   — signing secret for JWTs (REQUIRED in prod)
    FOUNDRY_SESSION_DAYS — token lifetime in days (default 7)
"""
from __future__ import annotations

import os
import secrets
import sys
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, Header, HTTPException, status
from pydantic import BaseModel

import db


# -----------------------------------------------------------------------------
# Configuration (env-driven)
# -----------------------------------------------------------------------------
def jwt_secret() -> str:
    """Returns the JWT signing secret. In production this MUST be set via
    FOUNDRY_JWT_SECRET; we fall back to a generated dev secret with a loud
    warning so local development still works out of the box."""
    val = os.environ.get("FOUNDRY_JWT_SECRET")
    if val:
        return val
    # Last-resort dev fallback — print once so it's visible in logs.
    global _dev_secret_warned
    if not _dev_secret_warned:
        print(
            "[auth] WARNING: FOUNDRY_JWT_SECRET not set — using an ephemeral "
            "dev secret. All sessions will be invalidated on restart. Set the "
            "secret in your env or .streamlit/secrets.toml for stable sessions.",
            file=sys.stderr,
        )
        _dev_secret_warned = True
    return _DEV_JWT_SECRET


_DEV_JWT_SECRET = secrets.token_hex(32)  # only used if env var is missing
_dev_secret_warned = False


def session_days() -> int:
    try:
        return int(os.environ.get("FOUNDRY_SESSION_DAYS") or 7)
    except ValueError:
        return 7


# -----------------------------------------------------------------------------
# Passwords
# -----------------------------------------------------------------------------
def hash_password(plain: str) -> str:
    # bcrypt has a 72-byte input limit; passwords longer than that are
    # truncated by spec. We slice explicitly to avoid surprising library
    # behavior.
    pw = plain.encode("utf-8")[:72]
    return bcrypt.hashpw(pw, bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        pw = plain.encode("utf-8")[:72]
        return bcrypt.checkpw(pw, hashed.encode("utf-8"))
    except Exception:
        return False


def generate_temp_password(length: int = 12) -> str:
    """Random URL-safe token used as the one-time password an admin hands
    to a new user. ~9 bytes of entropy = 12 base64url chars."""
    return secrets.token_urlsafe(max(6, length * 3 // 4))[:length]


# -----------------------------------------------------------------------------
# JWT
# -----------------------------------------------------------------------------
def create_access_token(user_id: str, email: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=session_days())).timestamp()),
    }
    return jwt.encode(payload, jwt_secret(), algorithm="HS256")


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, jwt_secret(), algorithms=["HS256"])


# -----------------------------------------------------------------------------
# User model + DB ops
# -----------------------------------------------------------------------------
class CurrentUser(BaseModel):
    id: str
    email: str
    full_name: str
    role: str


def create_user(email: str, full_name: str, password: str, role: str = "rep") -> dict:
    user_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    record = {
        "id": user_id,
        "email": email.strip().lower(),
        "full_name": full_name.strip(),
        "password_hash": hash_password(password),
        "role": role,
        "is_active": 1,
        "created_at": now,
        "last_login_at": None,
    }
    db.create_user(record)
    return _strip_pw(record)


def authenticate(email: str, password: str) -> Optional[dict]:
    user = db.find_user_by_email(email.strip().lower())
    if not user or not user.get("is_active"):
        return None
    if not verify_password(password, user.get("password_hash") or ""):
        return None
    db.touch_last_login(user["id"])
    return _strip_pw(user)


def update_profile(user_id: str, full_name: str | None = None) -> dict | None:
    updated = db.update_user(user_id, full_name=full_name)
    return _strip_pw(updated) if updated else None


def change_password(user_id: str, current_password: str, new_password: str) -> bool:
    """User-driven self-service password change (requires current password)."""
    user = db.get_user(user_id)
    if not user:
        return False
    if not verify_password(current_password, user.get("password_hash") or ""):
        return False
    db.set_user_password(user_id, hash_password(new_password))
    return True


def admin_set_password(user_id: str, new_password: str) -> bool:
    """Admin-driven password reset (no current-password check)."""
    if not db.get_user(user_id):
        return False
    db.set_user_password(user_id, hash_password(new_password))
    return True


def _strip_pw(rec: dict | None) -> dict | None:
    if not rec:
        return None
    return {k: v for k, v in rec.items() if k != "password_hash"}


# -----------------------------------------------------------------------------
# Personal API key helpers — used by current_user() to accept either a JWT
# from the web app or a personal access token from a script / integration.
# Keys look like `fdr_<24-url-safe-chars>`; the first 8 chars after the
# prefix double as a lookup index in `api_keys.prefix`.
# -----------------------------------------------------------------------------
API_KEY_PREFIX = "fdr_"

def generate_api_key() -> tuple[str, str, str]:
    """Return (cleartext_key, display_prefix, bcrypt_hash). The cleartext
    is shown to the user exactly once at creation time and never stored."""
    raw = secrets.token_urlsafe(24)
    cleartext = f"{API_KEY_PREFIX}{raw}"
    # Index by the first 8 characters of `raw` so we can do a fast lookup
    # without scanning every row in the table.
    display_prefix = raw[:8]
    key_hash = hash_password(cleartext)
    return cleartext, display_prefix, key_hash


def _verify_api_key(presented: str) -> dict | None:
    """Resolve a presented API key to the owning user, or None if invalid /
    revoked. Touches `last_used_at` on success."""
    if not presented or not presented.startswith(API_KEY_PREFIX):
        return None
    raw = presented[len(API_KEY_PREFIX):]
    if len(raw) < 8:
        return None
    prefix = raw[:8]
    for row in db.find_api_key_by_prefix(prefix):
        if verify_password(presented, row.get("key_hash") or ""):
            user = db.get_user(row["user_id"])
            if user and user.get("is_active"):
                db.touch_api_key_used(row["id"])
                return user
    return None


# -----------------------------------------------------------------------------
# FastAPI dependency: inject the current user from the Authorization header.
# Accepts either a session JWT (web app) OR a personal API key (scripts /
# integrations). Both surface as the same CurrentUser model downstream.
# -----------------------------------------------------------------------------
def current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing or invalid Authorization header")
    token = authorization.split(" ", 1)[1]

    # API-key path — token looks like `fdr_<base64url>`. Skip JWT parsing.
    if token.startswith(API_KEY_PREFIX):
        user = _verify_api_key(token)
        if not user:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or revoked API key")
        return CurrentUser(
            id=user["id"],
            email=user["email"],
            full_name=user.get("full_name") or "",
            role=user.get("role") or "rep",
        )

    # JWT path (the web app)
    try:
        payload = decode_access_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired — please sign in again")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid session token")

    user = db.get_user(payload.get("sub"))
    if not user or not user.get("is_active"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account no longer active")
    return CurrentUser(
        id=user["id"],
        email=user["email"],
        full_name=user.get("full_name") or "",
        role=user.get("role") or "rep",
    )


def require_admin(user: CurrentUser = Depends(current_user)) -> CurrentUser:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return user
