"""
db.py — SQLite schema + CRUD operations for Foundry's PO ledger.

The DB lives in `foundry.db` next to this file. Schema is created on first
connection (idempotent). We use stdlib `sqlite3` only — no ORM — to keep
deployment dead simple.
"""
from __future__ import annotations

import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

DB_PATH = Path(__file__).parent / "foundry.db"

SCHEMA = """
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
  has_source INTEGER DEFAULT 0,        -- 1 if source PDF is stored in files/
  extraction_method TEXT DEFAULT 'text', -- 'text' | 'vision' (which path was used)
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
    """Create tables/indexes if they don't exist + apply lightweight migrations."""
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        # Add columns added in later versions (no-op if they exist)
        for col, ddl in [
            ("has_source", "INTEGER DEFAULT 0"),
            ("extraction_method", "TEXT DEFAULT 'text'"),
        ]:
            try:
                conn.execute(f"ALTER TABLE pos ADD COLUMN {col} {ddl}")
            except sqlite3.OperationalError:
                pass  # already exists


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


def list_pos(query: str = "", period: str = "all") -> list[dict]:
    """List POs with optional search query and period filter (all|7d|30d|90d).

    Returns each PO with its `line_items` array embedded.
    """
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

        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY added_at DESC"

        rows = conn.execute(sql, params).fetchall()
        return [_row_to_po(r, _list_lines(conn, r["id"])) for r in rows]


def get_po(po_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM pos WHERE id = ?", (po_id,)).fetchone()
        if not row:
            return None
        return _row_to_po(row, _list_lines(conn, po_id))


def find_by_po_number(po_number: str) -> dict | None:
    """Used for duplicate detection during extraction."""
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


def create_po(data: dict) -> dict:
    po_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    line_items = data.get("line_items") or []

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO pos (id, po_number, po_date, revision, customer, customer_address,
                             supplier, supplier_address, bill_to, ship_to, payment_terms,
                             buyer, buyer_email, currency, total, filename, notes,
                             added_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
                now,
                now,
            ),
        )
        _insert_line_items(conn, po_id, line_items)

    return get_po(po_id)


def update_po(po_id: str, data: dict) -> dict | None:
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
                now,
                po_id,
            ),
        )
        # Replace the line items wholesale (simpler than reconciling)
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
        return {
            "po_count": po_row["c"] or 0,
            "total_value": float(po_row["t"] or 0),
            "line_count": line_row["c"] or 0,
            "supplier_count": suppliers["c"] or 0,
        }
