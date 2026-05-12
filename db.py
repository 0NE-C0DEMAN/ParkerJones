"""
db.py — Storage dispatcher.

Picks the backend based on the FOUNDRY_DB_BACKEND env var or
.streamlit/secrets.toml. Backend modules expose the same function
signatures so the rest of the app doesn't care which is live.

Modes:
    sqlite (default) — local foundry.db; offline-friendly dev.
    turso            — cloud libSQL (production / hosted deploys).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

SECRETS_PATH = Path(__file__).parent / ".streamlit" / "secrets.toml"

VALID_BACKENDS = {"sqlite", "turso"}


def _resolve_backend() -> str:
    env = (os.environ.get("FOUNDRY_DB_BACKEND") or "").strip().lower()
    if env in VALID_BACKENDS:
        return env
    if SECRETS_PATH.exists():
        try:
            if sys.version_info >= (3, 11):
                import tomllib
                with SECRETS_PATH.open("rb") as f:
                    secrets = tomllib.load(f)
            else:
                import tomli  # type: ignore
                with SECRETS_PATH.open("rb") as f:
                    secrets = tomli.load(f)
            val = (secrets.get("FOUNDRY_DB_BACKEND") or "").strip().lower()
            if val in VALID_BACKENDS:
                return val
        except Exception as e:
            print(f"[db] Could not read secrets.toml: {e}", file=sys.stderr)
    return "sqlite"


BACKEND = _resolve_backend()

if BACKEND == "turso":
    print("[db] Using Turso (libSQL) backend.", file=sys.stderr)
    from db_turso import *  # noqa: F401,F403
else:
    print("[db] Using SQLite backend.", file=sys.stderr)
    from db_sqlite import *  # noqa: F401,F403
