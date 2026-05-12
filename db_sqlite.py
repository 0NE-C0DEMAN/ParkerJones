"""
db.py — SQLite schema + CRUD operations for Foundry.

Tables:
    users       — registered accounts (auth)
    pos         — purchase orders
    line_items  — line items per PO (FK)

The DB lives in `foundry.db` next to this file. Schema is created on first
connection (idempotent). Stdlib `sqlite3` only — no ORM — to keep deployment
dead simple.
"""
from __future__ import annotations

import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

# Path to the SQLite DB file. Configurable via FOUNDRY_SQLITE_PATH so we can
# point it at a mounted bucket (e.g. /home/user/app/data/foundry.db on HF
# Spaces). Falls back to `foundry.db` next to this file for local dev.
_env_path = os.environ.get("FOUNDRY_SQLITE_PATH")
DB_PATH = Path(_env_path) if _env_path else (Path(__file__).parent / "foundry.db")
# Make sure the parent directory exists — the bucket mount provides it in
# production, but a fresh local dev tree may not have it yet.
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'rep',
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS pos (
  id TEXT PRIMARY KEY,
  po_number TEXT NOT NULL,
  po_date TEXT,
  revision TEXT,
  customer TEXT,
  customer_address TEXT,
  supplier TEXT,
  supplier_address TEXT,
  bill_to TEXT,
  ship_to TEXT,
  payment_terms TEXT,
  buyer TEXT,
  buyer_email TEXT,
  currency TEXT DEFAULT 'USD',
  total REAL,
  filename TEXT,
  notes TEXT,
  status TEXT DEFAULT 'received',  -- received | acknowledged | in_progress | shipped | invoiced | closed
  has_source INTEGER DEFAULT 0,
  extraction_method TEXT DEFAULT 'text',
  created_by_id TEXT,
  created_by_email TEXT,
  updated_by_id TEXT,
  updated_by_email TEXT,
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pos_po_number ON pos(po_number);
CREATE INDEX IF NOT EXISTS idx_pos_added_at ON pos(added_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_customer ON pos(customer);

CREATE TABLE IF NOT EXISTS line_items (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL,
  line INTEGER,
  customer_part TEXT,
  vendor_part TEXT,
  description TEXT,
  quantity REAL,
  uom TEXT,
  unit_price REAL,
  amount REAL,
  required_date TEXT,
  FOREIGN KEY (po_id) REFERENCES pos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_line_items_po_id ON line_items(po_id);
"""

# Migrations — additive columns added in later versions. Each tuple is
# (column_name, DDL_after_TYPE_keyword). ALTER TABLE ADD COLUMN is no-op
# in catch block if the column already exists.
MIGRATIONS = [
    ("has_source", "INTEGER DEFAULT 0"),
    ("extraction_method", "TEXT DEFAULT 'text'"),
    ("status", "TEXT DEFAULT 'received'"),
    ("created_by_id", "TEXT"),
    ("created_by_email", "TEXT"),
    ("updated_by_id", "TEXT"),
    ("updated_by_email", "TEXT"),
    # Soft-delete tombstone — kept so list_* queries can filter out
    # deleted rows without rewriting history. Inserted by delete_po /
    # delete_user.
    ("deleted_at", "TEXT"),
]

USER_MIGRATIONS = [
    ("deleted_at", "TEXT"),
]

LINE_ITEM_MIGRATIONS = [
    ("deleted_at", "TEXT"),
]


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init() -> None:
    """Create tables/indexes if they don't exist + apply migrations."""
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        # Apply additive column migrations BEFORE creating indexes that
        # reference those columns.
        for col, ddl in MIGRATIONS:
            try:
                conn.execute(f"ALTER TABLE pos ADD COLUMN {col} {ddl}")
            except sqlite3.OperationalError:
                pass
        for col, ddl in USER_MIGRATIONS:
            try:
                conn.execute(f"ALTER TABLE users ADD COLUMN {col} {ddl}")
            except sqlite3.OperationalError:
                pass
        for col, ddl in LINE_ITEM_MIGRATIONS:
            try:
                conn.execute(f"ALTER TABLE line_items ADD COLUMN {col} {ddl}")
            except sqlite3.OperationalError:
                pass
        # Indexes that depend on migrated columns
        for stmt in [
            "CREATE INDEX IF NOT EXISTS idx_pos_status ON pos(status)",
            "CREATE INDEX IF NOT EXISTS idx_pos_created_by ON pos(created_by_id)",
        ]:
            try:
                conn.execute(stmt)
            except sqlite3.OperationalError:
                pass


# =============================================================================
# Users
# =============================================================================

def create_user(record: dict) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO users (id, email, full_name, password_hash, role, is_active, created_at, last_login_at)
            VALUES (?,?,?,?,?,?,?,?)
            """,
            (
                record["id"], record["email"], record.get("full_name") or "",
                record["password_hash"], record.get("role") or "rep",
                1 if record.get("is_active", True) else 0,
                record["created_at"], record.get("last_login_at"),
            ),
        )


def get_user(user_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def find_user_by_email(email: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email.strip().lower(),)).fetchone()
        return dict(row) if row else None


def update_user(user_id: str, full_name: str | None = None) -> dict | None:
    with get_conn() as conn:
        if full_name is not None:
            conn.execute("UPDATE users SET full_name = ? WHERE id = ?", (full_name, user_id))
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def set_user_password(user_id: str, password_hash: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))


def touch_last_login(user_id: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?",
                     (datetime.now().isoformat(), user_id))


def list_users() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, email, full_name, role, is_active, created_at, last_login_at FROM users ORDER BY created_at"
        ).fetchall()
        return [dict(r) for r in rows]


def set_user_active(user_id: str, active: bool) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE users SET is_active = ? WHERE id = ?", (1 if active else 0, user_id))


# =============================================================================
# POs
# =============================================================================

def _row_to_po(row: sqlite3.Row, line_items: list[dict]) -> dict:
    d = dict(row)
    d["line_items"] = line_items
    return d


def _list_lines(conn: sqlite3.Connection, po_id: str) -> list[dict]:
    cur = conn.execute(
        "SELECT * FROM line_items WHERE po_id = ? ORDER BY line",
        (po_id,),
    )
    return [dict(r) for r in cur.fetchall()]


def list_pos(query: str = "", period: str = "all", status: str = "all", created_by_id: str | None = None) -> list[dict]:
    with get_conn() as conn:
        sql = "SELECT * FROM pos"
        params: list[Any] = []
        clauses: list[str] = []

        if query:
            q = f"%{query.strip()}%"
            clauses.append(
                "(po_number LIKE ? OR customer LIKE ? OR supplier LIKE ? OR buyer LIKE ?"
                " OR id IN (SELECT po_id FROM line_items WHERE description LIKE ?"
                "                                          OR vendor_part LIKE ?"
                "                                          OR customer_part LIKE ?))"
            )
            params.extend([q, q, q, q, q, q, q])

        if period and period != "all":
            days_map = {"7d": 7, "30d": 30, "90d": 90}
            days = days_map.get(period)
            if days:
                cutoff = (datetime.now() - timedelta(days=days)).isoformat()
                clauses.append("added_at >= ?")
                params.append(cutoff)

        if status and status != "all":
            clauses.append("status = ?")
            params.append(status)

        if created_by_id:
            clauses.append("created_by_id = ?")
            params.append(created_by_id)

        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY updated_at DESC"

        rows = conn.execute(sql, params).fetchall()
        return [_row_to_po(r, _list_lines(conn, r["id"])) for r in rows]


def get_po(po_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM pos WHERE id = ?", (po_id,)).fetchone()
        if not row:
            return None
        return _row_to_po(row, _list_lines(conn, po_id))


def find_by_po_number(po_number: str) -> dict | None:
    if not po_number:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM pos WHERE po_number = ? ORDER BY added_at DESC LIMIT 1",
            (po_number.strip(),),
        ).fetchone()
        if not row:
            return None
        return _row_to_po(row, _list_lines(conn, row["id"]))


def _insert_line_items(conn: sqlite3.Connection, po_id: str, items: Iterable[dict]) -> None:
    for it in items:
        conn.execute(
            """
            INSERT INTO line_items (id, po_id, line, customer_part, vendor_part,
                                    description, quantity, uom, unit_price, amount, required_date)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                str(uuid.uuid4()),
                po_id,
                int(it.get("line") or 0),
                str(it.get("customer_part") or ""),
                str(it.get("vendor_part") or ""),
                str(it.get("description") or ""),
                float(it.get("quantity") or 0),
                str(it.get("uom") or "EA"),
                float(it.get("unit_price") or 0),
                float(it.get("amount") or 0),
                str(it.get("required_date") or ""),
            ),
        )


def create_po(data: dict, *, created_by_id: str | None = None, created_by_email: str | None = None) -> dict:
    po_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    line_items = data.get("line_items") or []

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO pos (id, po_number, po_date, revision, customer, customer_address,
                             supplier, supplier_address, bill_to, ship_to, payment_terms,
                             buyer, buyer_email, currency, total, filename, notes, status,
                             extraction_method,
                             created_by_id, created_by_email,
                             updated_by_id, updated_by_email,
                             added_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                po_id,
                str(data.get("po_number") or ""),
                str(data.get("po_date") or ""),
                str(data.get("revision") or ""),
                str(data.get("customer") or ""),
                str(data.get("customer_address") or ""),
                str(data.get("supplier") or ""),
                str(data.get("supplier_address") or ""),
                str(data.get("bill_to") or ""),
                str(data.get("ship_to") or ""),
                str(data.get("payment_terms") or ""),
                str(data.get("buyer") or ""),
                str(data.get("buyer_email") or ""),
                str(data.get("currency") or "USD"),
                float(data.get("total") or 0),
                str(data.get("filename") or ""),
                str(data.get("notes") or ""),
                str(data.get("status") or "received"),
                str(data.get("extraction_method") or "text"),
                created_by_id, created_by_email,
                created_by_id, created_by_email,
                now, now,
            ),
        )
        _insert_line_items(conn, po_id, line_items)

    return get_po(po_id)


def update_po(po_id: str, data: dict, *, updated_by_id: str | None = None, updated_by_email: str | None = None) -> dict | None:
    now = datetime.now().isoformat()
    line_items = data.get("line_items") or []

    with get_conn() as conn:
        existing = conn.execute("SELECT 1 FROM pos WHERE id = ?", (po_id,)).fetchone()
        if not existing:
            return None
        conn.execute(
            """
            UPDATE pos SET po_number=?, po_date=?, revision=?, customer=?, customer_address=?,
                           supplier=?, supplier_address=?, bill_to=?, ship_to=?, payment_terms=?,
                           buyer=?, buyer_email=?, currency=?, total=?, filename=?, notes=?,
                           status=?,
                           updated_by_id=?, updated_by_email=?,
                           updated_at=?
            WHERE id=?
            """,
            (
                str(data.get("po_number") or ""),
                str(data.get("po_date") or ""),
                str(data.get("revision") or ""),
                str(data.get("customer") or ""),
                str(data.get("customer_address") or ""),
                str(data.get("supplier") or ""),
                str(data.get("supplier_address") or ""),
                str(data.get("bill_to") or ""),
                str(data.get("ship_to") or ""),
                str(data.get("payment_terms") or ""),
                str(data.get("buyer") or ""),
                str(data.get("buyer_email") or ""),
                str(data.get("currency") or "USD"),
                float(data.get("total") or 0),
                str(data.get("filename") or ""),
                str(data.get("notes") or ""),
                str(data.get("status") or "received"),
                updated_by_id, updated_by_email,
                now,
                po_id,
            ),
        )
        conn.execute("DELETE FROM line_items WHERE po_id = ?", (po_id,))
        _insert_line_items(conn, po_id, line_items)

    return get_po(po_id)


def delete_po(po_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM pos WHERE id = ?", (po_id,))
        return cur.rowcount > 0


def mark_source_stored(po_id: str, has_source: bool = True) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE pos SET has_source = ? WHERE id = ?", (1 if has_source else 0, po_id))


def clear_all() -> int:
    with get_conn() as conn:
        cur = conn.execute("SELECT COUNT(*) AS c FROM pos").fetchone()
        n = cur["c"] if cur else 0
        conn.execute("DELETE FROM pos")
        return n


def list_distinct(field: str) -> list[str]:
    """Sorted unique non-empty values for a PO column (used by autocomplete)."""
    if field not in {"customer", "supplier", "buyer", "payment_terms"}:
        return []
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT DISTINCT {field} AS v FROM pos WHERE {field} IS NOT NULL AND {field} <> '' ORDER BY {field}"
        ).fetchall()
        return [r["v"] for r in rows]


def stats() -> dict:
    with get_conn() as conn:
        po_row = conn.execute(
            "SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS t FROM pos"
        ).fetchone()
        line_row = conn.execute(
            "SELECT COUNT(*) AS c FROM line_items"
        ).fetchone()
        suppliers = conn.execute(
            "SELECT COUNT(DISTINCT supplier) AS c FROM pos WHERE supplier <> ''"
        ).fetchone()
        active_users = conn.execute(
            "SELECT COUNT(*) AS c FROM users WHERE is_active = 1"
        ).fetchone()
        return {
            "po_count": po_row["c"] or 0,
            "total_value": float(po_row["t"] or 0),
            "line_count": line_row["c"] or 0,
            "supplier_count": suppliers["c"] or 0,
            "active_user_count": active_users["c"] or 0,
        }
