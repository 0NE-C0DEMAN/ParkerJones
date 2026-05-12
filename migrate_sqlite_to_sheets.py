"""
migrate_sqlite_to_sheets.py — One-shot copy of foundry.db rows into the
Google Sheet configured in .streamlit/secrets.toml.

Run from the repo root:
    python migrate_sqlite_to_sheets.py
    python migrate_sqlite_to_sheets.py --dry-run   (preview, don't write)

Safe to re-run: skips rows whose `id` already exists in the sheet.
"""
from __future__ import annotations

import argparse
import sys
import time

import db_sqlite
import db_sheets


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Show what would happen, don't write")
    parser.add_argument("--clear-target", action="store_true", help="Empty the target sheet tabs first")
    args = parser.parse_args()

    print("→ Initializing target sheet (creating tabs/headers if needed)...")
    db_sheets.init()

    if args.clear_target and not args.dry_run:
        print("→ Clearing existing sheet contents...")
        db_sheets.clear_all()
        # Note: clear_all only clears POs+LineItems, not Users — we want to preserve users on re-run

    # ---------- Users ----------
    print("\n→ Migrating users...")
    src_users = db_sqlite.list_users()
    print(f"   Found {len(src_users)} users in SQLite")
    existing_user_ids = {u["id"] for u in db_sheets.list_users()}
    new_users = [u for u in src_users if u["id"] not in existing_user_ids]
    print(f"   {len(new_users)} new to migrate ({len(src_users) - len(new_users)} already in sheet)")
    if not args.dry_run:
        for i, u in enumerate(new_users, 1):
            full = db_sqlite.get_user(u["id"])  # includes password_hash
            if full:
                db_sheets.create_user({
                    **full,
                    "is_active": bool(full.get("is_active", 1)),
                })
            print(f"   [{i}/{len(new_users)}] {u['email']}")

    # ---------- POs + Line Items ----------
    print("\n→ Migrating purchase orders...")
    src_pos = db_sqlite.list_pos()
    print(f"   Found {len(src_pos)} POs in SQLite")
    existing_po_ids = {p["id"] for p in db_sheets.list_pos()}
    new_pos = [p for p in src_pos if p["id"] not in existing_po_ids]
    print(f"   {len(new_pos)} new to migrate ({len(src_pos) - len(new_pos)} already in sheet)")

    if not args.dry_run:
        for i, p in enumerate(new_pos, 1):
            full = db_sqlite.get_po(p["id"])
            if not full:
                continue
            db_sheets.create_po(
                full,
                created_by_id=full.get("created_by_id") or "",
                created_by_email=full.get("created_by_email") or "",
            )
            print(f"   [{i}/{len(new_pos)}] {full['po_number']} ({full.get('customer','—')}) — {len(full.get('line_items', []))} lines")
            time.sleep(0.5)  # be polite to the Sheets API rate limit

    print("\n✓ Migration complete." + (" (dry run, nothing written)" if args.dry_run else ""))
    print(f"  Target sheet: {db_sheets._sheet_id()}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nAborted.", file=sys.stderr)
        sys.exit(1)
