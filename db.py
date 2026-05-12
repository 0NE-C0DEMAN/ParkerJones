"""
db.py — Storage dispatcher.

Picks the backend (SQLite or Google Sheets) based on the
FOUNDRY_DB_BACKEND environment variable or .streamlit/secrets.toml. Backend
modules expose the same function signatures, so backend.py and auth.py can
swap stores transparently.

Choose:
    FOUNDRY_DB_BACKEND=sqlite   (default — local foundry.db)
    FOUNDRY_DB_BACKEND=sheets   (requires gcp_service_account in secrets.toml)
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

SECRETS_PATH = Path(__file__).parent / ".streamlit" / "secrets.toml"


VALID_BACKENDS = {"sqlite", "sheets", "turso", "hybrid"}


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

if BACKEND == "sheets":
    print("[db] Using Google Sheets backend.", file=sys.stderr)
    from db_sheets import *  # noqa: F401,F403
elif BACKEND == "turso":
    print("[db] Using Turso (libSQL) backend.", file=sys.stderr)
    from db_turso import *  # noqa: F401,F403
elif BACKEND == "hybrid":
    print("[db] Using HYBRID backend (local SQLite + Turso sync).", file=sys.stderr)
    from db_hybrid import *  # noqa: F401,F403
else:
    print("[db] Using SQLite backend.", file=sys.stderr)
    from db_sqlite import *  # noqa: F401,F403
