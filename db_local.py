"""
db_local.py — Local SQLite layer for the hybrid backend.

This is the read/write hot path: the React app talks to the FastAPI process,
which talks to this module. All operations hit a local SQLite file
(~/.foundry/local.db by default), so reads are <1 ms and writes are <10 ms.

Writes also append to an `outbox` table; sync_engine.py periodically drains
the outbox by pushing changes to Turso and pulling remote changes back.

Public interface mirrors db_sqlite.py.
"""
from __future__ import annotations

import os
import sqlite3
import sys
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

# ---------------------------------------------------------------------------
# Where the local DB lives
# ---------------------------------------------------------------------------

DEFAULT_LOCAL_DIR = Path(os.environ.get("FOUNDRY_LOCAL_DIR") or (Path.home() / ".foundry"))
DEFAULT_LOCAL_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DEFAULT_LOCAL_DIR / "local.db"


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'rep',
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  deleted_at TEXT
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
  status TEXT DEFAULT 'received',
  has_source INTEGER DEFAULT 0,
  extraction_method TEXT DEFAULT 'text',
  created_by_id TEXT,
  created_by_email TEXT,
  updated_by_id TEXT,
  updated_by_email TEXT,
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_pos_po_number ON pos(po_number);
CREATE INDEX IF NOT EXISTS idx_pos_added_at ON pos(added_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_customer ON pos(customer);
CREATE INDEX IF NOT EXISTS idx_pos_updated_at ON pos(updated_at DESC);

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
  deleted_at TEXT,
  FOREIGN KEY (po_id) REFERENCES pos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_line_items_po_id ON line_items(po_id);

-- Pending operations to push to Turso. Coalesced by entity (one row per id).
CREATE TABLE IF NOT EXISTS outbox_pos (
  po_id TEXT PRIMARY KEY,
  queued_at TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS outbox_users (
  user_id TEXT PRIMARY KEY,
  queued_at TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  last_error TEXT
);

-- Cross-cutting key/value (last_pull_at, etc.)
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
);
"""


_conn_lock = threading.Lock()


@contextmanager
def get_conn():
    """Per-call connection (SQLite + WAL = safe across threads)."""
    conn = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
    finally:
        conn.close()


def init() -> None:
    with _conn_lock:
        with get_conn() as conn:
            conn.executescript(SCHEMA)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now() -> str:
    return datetime.now().isoformat()


def _queue_po(po_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO outbox_pos (po_id, queued_at) VALUES (?, ?) "
            "ON CONFLICT(po_id) DO UPDATE SET queued_at = excluded.queued_at, attempts = 0, last_error = NULL",
            (po_id, _now()),
        )


def _queue_user(user_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO outbox_users (user_id, queued_at) VALUES (?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET queued_at = excluded.queued_at, attempts = 0, last_error = NULL",
            (user_id, _now()),
        )


def _row_to_po(row: sqlite3.Row, lines: list[dict]) -> dict:
    d = dict(row)
    d["line_items"] = lines
    return d


def _list_lines(conn: sqlite3.Connection, po_id: str) -> list[dict]:
    cur = conn.execute(
        "SELECT * FROM line_items WHERE po_id = ? AND deleted_at IS NULL ORDER BY line",
        (po_id,),
    )
    return [dict(r) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

def create_user(record: dict) -> None:
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO users (id, email, full_name, password_hash, role, is_active, created_at, last_login_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                record["id"], record["email"], record.get("full_name") or "",
                record["password_hash"], record.get("role") or "rep",
                1 if record.get("is_active", True) else 0,
                record["created_at"], record.get("last_login_at"),
            ),
        )
    _queue_user(record["id"])


def get_user(user_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE id = ? AND deleted_at IS NULL", (user_id,)
        ).fetchone()
        return dict(row) if row else None


def find_user_by_email(email: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE email = ? AND deleted_at IS NULL",
            ((email or "").strip().lower(),),
        ).fetchone()
        return dict(row) if row else None


def update_user(user_id: str, full_name: str | None = None) -> dict | None:
    if full_name is not None:
        with get_conn() as conn:
            conn.execute("UPDATE users SET full_name = ? WHERE id = ?", (full_name, user_id))
        _queue_user(user_id)
    return get_user(user_id)


def set_user_password(user_id: str, password_hash: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))
    _queue_user(user_id)


def touch_last_login(user_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE users SET last_login_at = ? WHERE id = ?",
            (_now(), user_id),
        )
    _queue_user(user_id)


def list_users() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, email, full_name, role, is_active, created_at, last_login_at "
            "FROM users WHERE deleted_at IS NULL ORDER BY created_at"
        ).fetchall()
        return [dict(r) for r in rows]


def set_user_active(user_id: str, active: bool) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE users SET is_active = ? WHERE id = ?", (1 if active else 0, user_id))
    _queue_user(user_id)


# ---------------------------------------------------------------------------
# POs
# ---------------------------------------------------------------------------

def _insert_line_items(conn: sqlite3.Connection, po_id: str, items: Iterable[dict]) -> None:
    for it in items:
        conn.execute(
            """INSERT INTO line_items
               (id, po_id, line, customer_part, vendor_part, description,
                quantity, uom, unit_price, amount, required_date)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                str(uuid.uuid4()), po_id, int(it.get("line") or 0),
                str(it.get("customer_part") or ""), str(it.get("vendor_part") or ""),
                str(it.get("description") or ""), float(it.get("quantity") or 0),
                str(it.get("uom") or "EA"), float(it.get("unit_price") or 0),
                float(it.get("amount") or 0), str(it.get("required_date") or ""),
            ),
        )


def list_pos(query: str = "", period: str = "all", status: str = "all", created_by_id: str | None = None) -> list[dict]:
    sql = "SELECT * FROM pos"
    params: list[Any] = []
    clauses: list[str] = ["deleted_at IS NULL"]
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
        days = {"7d": 7, "30d": 30, "90d": 90}.get(period)
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
    sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY updated_at DESC"

    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [_row_to_po(r, _list_lines(conn, r["id"])) for r in rows]


def get_po(po_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM pos WHERE id = ? AND deleted_at IS NULL", (po_id,)
        ).fetchone()
        if not row:
            return None
        return _row_to_po(row, _list_lines(conn, po_id))


def find_by_po_number(po_number: str) -> dict | None:
    if not po_number:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM pos WHERE po_number = ? AND deleted_at IS NULL ORDER BY added_at DESC LIMIT 1",
            (po_number.strip(),),
        ).fetchone()
        if not row:
            return None
        return _row_to_po(row, _list_lines(conn, row["id"]))


def create_po(data: dict, *, created_by_id: str | None = None, created_by_email: str | None = None) -> dict:
    po_id = str(uuid.uuid4())
    now = _now()
    line_items = data.get("line_items") or []
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO pos (id, po_number, po_date, revision, customer, customer_address,
                                supplier, supplier_address, bill_to, ship_to, payment_terms,
                                buyer, buyer_email, currency, total, filename, notes, status,
                                extraction_method,
                                created_by_id, created_by_email,
                                updated_by_id, updated_by_email,
                                added_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                po_id,
                str(data.get("po_number") or ""), str(data.get("po_date") or ""),
                str(data.get("revision") or ""), str(data.get("customer") or ""),
                str(data.get("customer_address") or ""), str(data.get("supplier") or ""),
                str(data.get("supplier_address") or ""), str(data.get("bill_to") or ""),
                str(data.get("ship_to") or ""), str(data.get("payment_terms") or ""),
                str(data.get("buyer") or ""), str(data.get("buyer_email") or ""),
                str(data.get("currency") or "USD"), float(data.get("total") or 0),
                str(data.get("filename") or ""), str(data.get("notes") or ""),
                str(data.get("status") or "received"),
                str(data.get("extraction_method") or "text"),
                created_by_id, created_by_email,
                created_by_id, created_by_email,
                now, now,
            ),
        )
        _insert_line_items(conn, po_id, line_items)
    _queue_po(po_id)
    return get_po(po_id)


def update_po(po_id: str, data: dict, *, updated_by_id: str | None = None, updated_by_email: str | None = None) -> dict | None:
    now = _now()
    line_items = data.get("line_items") or []
    with get_conn() as conn:
        existing = conn.execute("SELECT 1 FROM pos WHERE id = ?", (po_id,)).fetchone()
        if not existing:
            return None
        conn.execute(
            """UPDATE pos SET po_number=?, po_date=?, revision=?, customer=?, customer_address=?,
                              supplier=?, supplier_address=?, bill_to=?, ship_to=?, payment_terms=?,
                              buyer=?, buyer_email=?, currency=?, total=?, filename=?, notes=?,
                              status=?,
                              updated_by_id=?, updated_by_email=?,
                              updated_at=?
               WHERE id=?""",
            (
                str(data.get("po_number") or ""), str(data.get("po_date") or ""),
                str(data.get("revision") or ""), str(data.get("customer") or ""),
                str(data.get("customer_address") or ""), str(data.get("supplier") or ""),
                str(data.get("supplier_address") or ""), str(data.get("bill_to") or ""),
                str(data.get("ship_to") or ""), str(data.get("payment_terms") or ""),
                str(data.get("buyer") or ""), str(data.get("buyer_email") or ""),
                str(data.get("currency") or "USD"), float(data.get("total") or 0),
                str(data.get("filename") or ""), str(data.get("notes") or ""),
                str(data.get("status") or "received"),
                updated_by_id, updated_by_email,
                now, po_id,
            ),
        )
        conn.execute("DELETE FROM line_items WHERE po_id = ?", (po_id,))
        _insert_line_items(conn, po_id, line_items)
    _queue_po(po_id)
    return get_po(po_id)


def delete_po(po_id: str) -> bool:
    """Soft delete. Tombstone propagates to Turso on next sync."""
    now = _now()
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE pos SET deleted_at = ?, updated_at = ? WHERE id = ?",
            (now, now, po_id),
        )
        if cur.rowcount == 0:
            return False
        conn.execute("UPDATE line_items SET deleted_at = ? WHERE po_id = ?", (now, po_id))
    _queue_po(po_id)
    return True


def mark_source_stored(po_id: str, has_source: bool = True) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE pos SET has_source = ?, updated_at = ? WHERE id = ?",
            (1 if has_source else 0, _now(), po_id),
        )
    _queue_po(po_id)


def clear_all() -> int:
    """Soft-delete every PO + line item (admin-only operation)."""
    now = _now()
    with get_conn() as conn:
        n = conn.execute("SELECT COUNT(*) FROM pos WHERE deleted_at IS NULL").fetchone()[0]
        conn.execute("UPDATE pos SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL", (now, now))
        conn.execute("UPDATE line_items SET deleted_at = ? WHERE deleted_at IS NULL", (now,))
        # Queue every PO id for push
        rows = conn.execute("SELECT id FROM pos").fetchall()
        for r in rows:
            conn.execute(
                "INSERT INTO outbox_pos (po_id, queued_at) VALUES (?, ?) "
                "ON CONFLICT(po_id) DO UPDATE SET queued_at = excluded.queued_at, attempts = 0",
                (r["id"], now),
            )
    return n


def list_distinct(field: str) -> list[str]:
    if field not in {"customer", "supplier", "buyer", "payment_terms"}:
        return []
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT DISTINCT {field} AS v FROM pos WHERE {field} IS NOT NULL AND {field} <> '' AND deleted_at IS NULL ORDER BY {field}"
        ).fetchall()
        return [r["v"] for r in rows]


def stats() -> dict:
    with get_conn() as conn:
        po_row = conn.execute(
            "SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS t FROM pos WHERE deleted_at IS NULL"
        ).fetchone()
        line_row = conn.execute(
            "SELECT COUNT(*) AS c FROM line_items WHERE deleted_at IS NULL"
        ).fetchone()
        suppliers = conn.execute(
            "SELECT COUNT(DISTINCT supplier) AS c FROM pos WHERE supplier <> '' AND deleted_at IS NULL"
        ).fetchone()
        active = conn.execute(
            "SELECT COUNT(*) AS c FROM users WHERE is_active = 1 AND deleted_at IS NULL"
        ).fetchone()
        return {
            "po_count": po_row["c"] or 0,
            "total_value": float(po_row["t"] or 0),
            "line_count": line_row["c"] or 0,
            "supplier_count": suppliers["c"] or 0,
            "active_user_count": active["c"] or 0,
        }


# ---------------------------------------------------------------------------
# Outbox + sync state (used by sync_engine)
# ---------------------------------------------------------------------------

def pending_po_count() -> int:
    with get_conn() as conn:
        return conn.execute("SELECT COUNT(*) FROM outbox_pos").fetchone()[0]


def pending_user_count() -> int:
    with get_conn() as conn:
        return conn.execute("SELECT COUNT(*) FROM outbox_users").fetchone()[0]


def outbox_pos_pending() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT po_id, queued_at, attempts FROM outbox_pos ORDER BY queued_at"
        ).fetchall()
        return [dict(r) for r in rows]


def outbox_users_pending() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT user_id, queued_at, attempts FROM outbox_users ORDER BY queued_at"
        ).fetchall()
        return [dict(r) for r in rows]


def outbox_po_done(po_id: str, expected_queued_at: str | None = None) -> None:
    """Remove an outbox entry ONLY if no new edit landed mid-push.
    `expected_queued_at` was the timestamp the pusher read; if the user has
    since queued a newer edit, the outbox row's queued_at is newer and we
    leave it alone so the next sync cycle picks up the change."""
    with get_conn() as conn:
        if expected_queued_at is None:
            conn.execute("DELETE FROM outbox_pos WHERE po_id = ?", (po_id,))
        else:
            conn.execute(
                "DELETE FROM outbox_pos WHERE po_id = ? AND queued_at = ?",
                (po_id, expected_queued_at),
            )


def outbox_user_done(user_id: str, expected_queued_at: str | None = None) -> None:
    with get_conn() as conn:
        if expected_queued_at is None:
            conn.execute("DELETE FROM outbox_users WHERE user_id = ?", (user_id,))
        else:
            conn.execute(
                "DELETE FROM outbox_users WHERE user_id = ? AND queued_at = ?",
                (user_id, expected_queued_at),
            )


def outbox_po_failed(po_id: str, error: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE outbox_pos SET attempts = attempts + 1, last_error = ? WHERE po_id = ?",
            (error[:500], po_id),
        )


def outbox_user_failed(user_id: str, error: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE outbox_users SET attempts = attempts + 1, last_error = ? WHERE user_id = ?",
            (error[:500], user_id),
        )


def raw_po_row(po_id: str) -> dict | None:
    """Read a PO row INCLUDING soft-deleted (used by sync push)."""
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM pos WHERE id = ?", (po_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        lines = conn.execute(
            "SELECT * FROM line_items WHERE po_id = ? ORDER BY line", (po_id,)
        ).fetchall()
        d["line_items"] = [dict(r) for r in lines]
        return d


def raw_user_row(user_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def get_state(key: str, default: str | None = None) -> str | None:
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM sync_state WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default


def set_state(key: str, value: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO sync_state (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


def upsert_user_from_remote(remote: dict) -> str:
    """LWW upsert from remote — called by sync_engine pull. Returns 'kept_local',
    'updated_local', or 'inserted'."""
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT last_login_at, created_at FROM users WHERE id = ?",
            (remote["id"],),
        ).fetchone()
        remote_ts = remote.get("last_login_at") or remote.get("created_at") or ""
        if existing:
            local_ts = existing["last_login_at"] or existing["created_at"] or ""
            if local_ts >= remote_ts:
                return "kept_local"
            conn.execute("DELETE FROM users WHERE id = ?", (remote["id"],))
            verb = "updated_local"
        else:
            verb = "inserted"
        conn.execute(
            """INSERT INTO users (id, email, full_name, password_hash, role, is_active, created_at, last_login_at, deleted_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                remote["id"], remote["email"], remote.get("full_name") or "",
                remote.get("password_hash") or "", remote.get("role") or "rep",
                int(remote.get("is_active") or 0),
                remote.get("created_at") or _now(),
                remote.get("last_login_at"),
                remote.get("deleted_at"),
            ),
        )
        return verb


def upsert_po_from_remote(remote: dict, remote_lines: list[dict]) -> str:
    """LWW upsert from remote — called by sync_engine pull."""
    with get_conn() as conn:
        existing = conn.execute("SELECT updated_at FROM pos WHERE id = ?", (remote["id"],)).fetchone()
        remote_ts = remote.get("updated_at") or ""
        if existing:
            local_ts = existing["updated_at"] or ""
            if local_ts >= remote_ts:
                return "kept_local"
            conn.execute("DELETE FROM pos WHERE id = ?", (remote["id"],))
            conn.execute("DELETE FROM line_items WHERE po_id = ?", (remote["id"],))
            verb = "updated_local"
        else:
            verb = "inserted"
        conn.execute(
            """INSERT INTO pos (id, po_number, po_date, revision, customer, customer_address,
                                supplier, supplier_address, bill_to, ship_to, payment_terms,
                                buyer, buyer_email, currency, total, filename, notes, status,
                                has_source, extraction_method,
                                created_by_id, created_by_email,
                                updated_by_id, updated_by_email,
                                added_at, updated_at, deleted_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                remote["id"],
                remote.get("po_number") or "", remote.get("po_date") or "",
                remote.get("revision") or "", remote.get("customer") or "",
                remote.get("customer_address") or "", remote.get("supplier") or "",
                remote.get("supplier_address") or "", remote.get("bill_to") or "",
                remote.get("ship_to") or "", remote.get("payment_terms") or "",
                remote.get("buyer") or "", remote.get("buyer_email") or "",
                remote.get("currency") or "USD", float(remote.get("total") or 0),
                remote.get("filename") or "", remote.get("notes") or "",
                remote.get("status") or "received",
                int(remote.get("has_source") or 0),
                remote.get("extraction_method") or "text",
                remote.get("created_by_id"), remote.get("created_by_email"),
                remote.get("updated_by_id"), remote.get("updated_by_email"),
                remote.get("added_at") or _now(),
                remote.get("updated_at") or _now(),
                remote.get("deleted_at"),
            ),
        )
        for ln in remote_lines:
            if ln.get("po_id") != remote["id"]:
                continue
            conn.execute(
                """INSERT INTO line_items
                   (id, po_id, line, customer_part, vendor_part, description,
                    quantity, uom, unit_price, amount, required_date, deleted_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    ln.get("id") or str(uuid.uuid4()), ln["po_id"], int(ln.get("line") or 0),
                    ln.get("customer_part") or "", ln.get("vendor_part") or "",
                    ln.get("description") or "", float(ln.get("quantity") or 0),
                    ln.get("uom") or "EA", float(ln.get("unit_price") or 0),
                    float(ln.get("amount") or 0), ln.get("required_date") or "",
                    ln.get("deleted_at"),
                ),
            )
        return verb
