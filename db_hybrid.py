"""
db_hybrid.py — Local-first backend with background sync to Turso.

Reads + writes go to the LOCAL SQLite DB (db_local). A background thread
(sync_engine) periodically pushes local changes to Turso and pulls remote
changes back. This gives the app:

  - sub-millisecond reads
  - sub-10ms writes (no waiting for the network)
  - works offline
  - resilient to Turso outages
  - eventual consistency across all reps (default 30s)

Activate via:
    FOUNDRY_DB_BACKEND = "hybrid"   in .streamlit/secrets.toml
"""
from __future__ import annotations

import sys

# Re-export everything from db_local (the read/write hot path)
from db_local import (  # noqa: F401
    init as _init_local,
    get_conn,
    create_user, get_user, find_user_by_email, update_user,
    set_user_password, touch_last_login, list_users, set_user_active,
    list_pos, get_po, find_by_po_number,
    create_po, update_po, delete_po,
    mark_source_stored, clear_all,
    list_distinct, stats,
)

import db_turso
import sync_engine


def init() -> None:
    """Initialize both layers + start the background sync thread."""
    _init_local()
    try:
        db_turso.init()
    except Exception as e:
        print(f"[db_hybrid] Turso init failed (will retry on next sync): {e}", file=sys.stderr)
    sync_engine.start_background_thread()


# Expose sync controls to backend.py / frontend
def sync_status() -> dict:
    return sync_engine.status()


def sync_now() -> dict:
    return sync_engine.sync_now()
