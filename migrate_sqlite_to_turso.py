"""
migrate_sqlite_to_turso.py — Copy local foundry.db rows into the Turso DB
configured in .streamlit/secrets.toml.

Run:
    python migrate_sqlite_to_turso.py
    python migrate_sqlite_to_turso.py --dry-run

Safe to re-run: skips rows whose `id` already exists.
"""
from __future__ import annotations

import argparse
import sys

import db_sqlite
import db_turso


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("→ Ensuring Turso schema is up to date...")
    db_turso.init()

    # ---------- Users ----------
    print("\n→ Migrating users...")
    src_users = db_sqlite.list_users()
    existing_user_ids = {u["id"] for u in db_turso.list_users()}
    new_users = [u for u in src_users if u["id"] not in existing_user_ids]
    print(f"   {len(src_users)} users in SQLite, {len(new_users)} new to migrate")

    if not args.dry_run:
        for i, u in enumerate(new_users, 1):
            full = db_sqlite.get_user(u["id"])  # include password_hash
            if full:
                db_turso.create_user({
                    **full,
                    "is_active": bool(full.get("is_active", 1)),
                })
            print(f"   [{i}/{len(new_users)}] {u['email']}")

    # ---------- POs + LineItems ----------
    print("\n→ Migrating purchase orders...")
    src_pos = db_sqlite.list_pos()
    existing_po_ids = {p["id"] for p in db_turso.list_pos()}
    new_pos = [p for p in src_pos if p["id"] not in existing_po_ids]
    print(f"   {len(src_pos)} POs in SQLite, {len(new_pos)} new to migrate")

    if not args.dry_run:
        for i, p in enumerate(new_pos, 1):
            full = db_sqlite.get_po(p["id"])
            if not full:
                continue
            db_turso.create_po(
                full,
                created_by_id=full.get("created_by_id") or None,
                created_by_email=full.get("created_by_email") or None,
            )
            print(f"   [{i}/{len(new_pos)}] {full['po_number']} ({full.get('customer','—')}) — {len(full.get('line_items', []))} lines")

    print("\n✓ Migration complete." + (" (dry run, nothing written)" if args.dry_run else ""))
    print(f"  Turso stats: {db_turso.stats()}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nAborted.", file=sys.stderr)
        sys.exit(1)
