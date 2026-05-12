"""
migrate_turso_to_sqlite.py — Pull all rows from Turso into a fresh local
foundry.db so we can mount it on the HF Space and drop Turso entirely.

Run from the repo root:
    python scripts/migrate_turso_to_sqlite.py
    python scripts/migrate_turso_to_sqlite.py --out ./foundry.db
    python scripts/migrate_turso_to_sqlite.py --dry-run

Safe to re-run — wipes & recreates the target file.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path

# Make sibling modules importable when run from scripts/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db_turso  # noqa: E402
import db_sqlite  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="./foundry.db", help="Target SQLite file (default: ./foundry.db)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    out_path = Path(args.out).resolve()
    if args.dry_run:
        print(f"DRY RUN — would write to {out_path}")
    else:
        if out_path.exists():
            out_path.unlink()
            print(f"  removed existing {out_path}")
        # Force db_sqlite to use this path so init() creates the schema there
        os.environ["FOUNDRY_SQLITE_PATH"] = str(out_path)
        # db_sqlite.DB_PATH was bound at import — replace it now
        db_sqlite.DB_PATH = out_path
        db_sqlite.init()
        print(f"  fresh schema written to {out_path}")

    # ---------- Users ----------
    users = db_turso._query("SELECT * FROM users")
    deleted = sum(1 for u in users if u.get("deleted_at"))
    print(f"\nUsers in Turso: {len(users)} (including {deleted} soft-deleted)")
    if not args.dry_run:
        with sqlite3.connect(out_path) as c:
            for u in users:
                c.execute(
                    """INSERT INTO users
                       (id, email, full_name, password_hash, role, is_active,
                        created_at, last_login_at, deleted_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        u["id"], u["email"], u.get("full_name"),
                        u["password_hash"], u.get("role") or "rep",
                        int(u.get("is_active") or 1),
                        u.get("created_at"), u.get("last_login_at"),
                        u.get("deleted_at"),
                    ),
                )
            c.commit()
        print(f"  copied {len(users)} users")

    # ---------- POs ----------
    pos = db_turso._query("SELECT * FROM pos")
    deleted = sum(1 for p in pos if p.get("deleted_at"))
    print(f"\nPOs in Turso: {len(pos)} (including {deleted} soft-deleted)")
    if not args.dry_run:
        with sqlite3.connect(out_path) as c:
            for p in pos:
                cols = [
                    "id", "po_number", "po_date", "revision", "customer",
                    "customer_address", "supplier", "supplier_address",
                    "bill_to", "ship_to", "payment_terms", "buyer",
                    "buyer_email", "currency", "total", "filename", "notes",
                    "status", "has_source", "extraction_method",
                    "created_by_id", "created_by_email",
                    "updated_by_id", "updated_by_email",
                    "added_at", "updated_at", "deleted_at",
                ]
                placeholders = ",".join("?" for _ in cols)
                c.execute(
                    f"INSERT INTO pos ({','.join(cols)}) VALUES ({placeholders})",
                    tuple(p.get(col) for col in cols),
                )
            c.commit()
        print(f"  copied {len(pos)} POs")

    # ---------- Line items ----------
    lines = db_turso._query("SELECT * FROM line_items")
    deleted = sum(1 for ln in lines if ln.get("deleted_at"))
    print(f"\nLine items in Turso: {len(lines)} (including {deleted} soft-deleted)")
    if not args.dry_run:
        with sqlite3.connect(out_path) as c:
            for ln in lines:
                cols = [
                    "id", "po_id", "line", "customer_part", "vendor_part",
                    "description", "quantity", "uom", "unit_price", "amount",
                    "required_date", "deleted_at",
                ]
                placeholders = ",".join("?" for _ in cols)
                c.execute(
                    f"INSERT INTO line_items ({','.join(cols)}) VALUES ({placeholders})",
                    tuple(ln.get(col) for col in cols),
                )
            c.commit()
        print(f"  copied {len(lines)} line items")

    if not args.dry_run:
        # Sanity-check: re-open with db_sqlite (now pointed at the new file)
        # and ask it for stats — same code path the live app would use.
        os.environ["FOUNDRY_SQLITE_PATH"] = str(out_path)
        db_sqlite.DB_PATH = out_path
        stats = db_sqlite.stats()
        print(f"\nLocal SQLite stats: {stats}")
    print("\nDone.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nAborted.", file=sys.stderr)
        sys.exit(1)
