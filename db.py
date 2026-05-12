"""
db.py — Storage dispatcher.

Foundry uses SQLite for everything. In production (HF Spaces) the .db file
lives on a mounted Bucket so writes persist across container restarts; in
local dev it sits next to the code. Either way, `db_sqlite` is the only
backend module the app talks to.

Set `FOUNDRY_SQLITE_PATH` to point at a non-default location (the HF Space
sets it to `/home/user/app/data/foundry.db`, which is the mount point of
the `SamTwo/foundry-db` bucket).
"""
from __future__ import annotations

import sys

print("[db] Using SQLite backend.", file=sys.stderr)
from db_sqlite import *  # noqa: F401,F403

BACKEND = "sqlite"
