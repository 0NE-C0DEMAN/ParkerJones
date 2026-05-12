"""
auth.py — Authentication primitives for Foundry.

Responsibilities:
    - Hash + verify passwords (bcrypt)
    - Issue + verify JWT tokens
    - Load and reload the YAML invitation list
    - Look up + create + update users in SQLite
    - FastAPI dependency that injects the current user from the Authorization header
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import bcrypt
import jwt
import yaml
from fastapi import Depends, Header, HTTPException, status
from pydantic import BaseModel

import db

ROOT = Path(__file__).parent
USERS_YAML = ROOT / "users.yaml"


# -----------------------------------------------------------------------------
# YAML invitation list
# -----------------------------------------------------------------------------
def load_yaml_config() -> dict:
    if not USERS_YAML.exists():
        return {"invited": [], "require_invitation": True, "default_role": "rep",
                "session_days": 7, "jwt_secret": "dev-secret-change-me"}
    with USERS_YAML.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def is_invited(email: str) -> tuple[bool, dict | None]:
    """Return (allowed, invitation_record). When require_invitation is False,
    everyone is allowed and the record is None."""
    cfg = load_yaml_config()
    if not cfg.get("require_invitation", True):
        return True, None
    email_norm = email.strip().lower()
    for inv in cfg.get("invited") or []:
        if (inv.get("email") or "").strip().lower() == email_norm:
            return True, inv
    return False, None


def jwt_secret() -> str:
    return os.environ.get("FOUNDRY_JWT_SECRET") or load_yaml_config().get(
        "jwt_secret", "dev-secret-change-me"
    )


def session_days() -> int:
    try:
        return int(load_yaml_config().get("session_days", 7))
    except Exception:
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
    return _strip_pw(db.update_user(user_id, full_name=full_name)) if db.update_user(user_id, full_name=full_name) else None


def change_password(user_id: str, current_password: str, new_password: str) -> bool:
    user = db.get_user(user_id)
    if not user:
        return False
    if not verify_password(current_password, user.get("password_hash") or ""):
        return False
    db.set_user_password(user_id, hash_password(new_password))
    return True


def _strip_pw(rec: dict | None) -> dict | None:
    if not rec:
        return None
    return {k: v for k, v in rec.items() if k != "password_hash"}


# -----------------------------------------------------------------------------
# FastAPI dependency: inject the current user from the Authorization header
# -----------------------------------------------------------------------------
def current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing or invalid Authorization header")
    token = authorization.split(" ", 1)[1]
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
