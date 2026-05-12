"""
db_turso.py — Turso (libSQL) backend for Foundry.

Same public interface as db_sqlite.py; uses the official `libsql` Python
package (HTTP transport — works with all current Turso URLs).

Credentials come from env vars (TURSO_DB_URL, TURSO_DB_TOKEN) or
.streamlit/secrets.toml.
"""
from __future__ import annotations

import os
import sys
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

import libsql


SECRETS_PATH = Path(__file__).parent / ".streamlit" / "secrets.toml"


def _load_secrets() -> dict:
    if not SECRETS_PATH.exists():
        return {}
    try:
        if sys.version_info >= (3, 11):
            import tomllib
            with SECRETS_PATH.open("rb") as f:
                return tomllib.load(f)
        else:
            import tomli  # type: ignore
            with SECRETS_PATH.open("rb") as f:
                return tomli.load(f)
    except Exception as e:
        print(f"[db_turso] secrets.toml read failed: {e}", file=sys.stderr)
        return {}


def _db_url() -> str:
    val = os.environ.get("TURSO_DB_URL")
    if val:
        return val
    val = _load_secrets().get("TURSO_DB_URL")
    if not val:
        raise RuntimeError("TURSO_DB_URL not set in env or secrets.toml.")
    return val


def _db_token() -> str:
    val = os.environ.get("TURSO_DB_TOKEN")
    if val:
        return val
    val = _load_secrets().get("TURSO_DB_TOKEN")
    if not val:
        raise RuntimeError("TURSO_DB_TOKEN not set in env or secrets.toml.")
    return val


# libsql.connect() returns a connection (sqlite3-style). Threads need
# separate connections.
_local = threading.local()


def _conn() -> "libsql.Connection":
    if getattr(_local, "conn", None) is None:
        _local.conn = libsql.connect(database=_db_url(), auth_token=_db_token())
    return _local.conn


def _rows_to_dicts(cur) -> list[dict]:
    cols = [d[0] for d in cur.description] if cur.description else []
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def _query(sql: str, params: Iterable = ()) -> list[dict]:
    cur = _conn().cursor()
    cur.execute(sql, list(params))
    return _rows_to_dicts(cur)


def _execute(sql: str, params: Iterable = ()) -> int:
    cur = _conn().cursor()
    cur.execute(sql, list(params))
    _conn().commit()
    return cur.rowcount if cur.rowcount is not None else 0


# ---------------------------------------------------------------------------
# Schema — identical to db_sqlite.py
# ---------------------------------------------------------------------------

SCHEMA_STATEMENTS = [
    """CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      full_name TEXT,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'rep',
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      last_login_at TEXT,
      deleted_at TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)",
    """CREATE TABLE IF NOT EXISTS pos (
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
    )""",
    "CREATE INDEX IF NOT EXISTS idx_pos_po_number ON pos(po_number)",
    "CREATE INDEX IF NOT EXISTS idx_pos_added_at ON pos(added_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_pos_customer ON pos(customer)",
    "CREATE INDEX IF NOT EXISTS idx_pos_status ON pos(status)",
    "CREATE INDEX IF NOT EXISTS idx_pos_created_by ON pos(created_by_id)",
    """CREATE TABLE IF NOT EXISTS line_items (
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
    )""",
    "CREATE INDEX IF NOT EXISTS idx_line_items_po_id ON line_items(po_id)",
]

# Additive column migrations for existing Turso DBs
MIGRATIONS = [
    ("pos", "deleted_at", "TEXT"),
    ("users", "deleted_at", "TEXT"),
    ("line_items", "deleted_at", "TEXT"),
]


def init() -> None:
    cur = _conn().cursor()
    for stmt in SCHEMA_STATEMENTS:
        try:
            cur.execute(stmt)
        except Exception as e:
            if "already" not in str(e).lower():
                print(f"[db_turso] init warning: {e}", file=sys.stderr)
    for table, col, ddl in MIGRATIONS:
        try:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")
        except Exception:
            pass  # column already exists
    _conn().commit()


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

def create_user(record: dict) -> None:
    _execute(
        """INSERT INTO users (id, email, full_name, password_hash, role, is_active, created_at, last_login_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            record["id"], record["email"], record.get("full_name") or "",
            record["password_hash"], record.get("role") or "rep",
            1 if record.get("is_active", True) else 0,
            record["created_at"], record.get("last_login_at"),
        ),
    )


def get_user(user_id: str) -> dict | None:
    rows = _query("SELECT * FROM users WHERE id = ? AND deleted_at IS NULL", (user_id,))
    return rows[0] if rows else None


def find_user_by_email(email: str) -> dict | None:
    rows = _query(
        "SELECT * FROM users WHERE email = ? AND deleted_at IS NULL",
        ((email or "").strip().lower(),),
    )
    return rows[0] if rows else None


def update_user(user_id: str, full_name: str | None = None) -> dict | None:
    if full_name is not None:
        _execute("UPDATE users SET full_name = ? WHERE id = ?", (full_name, user_id))
    return get_user(user_id)


def set_user_password(user_id: str, password_hash: str) -> None:
    _execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))


def touch_last_login(user_id: str) -> None:
    _execute(
        "UPDATE users SET last_login_at = ? WHERE id = ?",
        (datetime.now().isoformat(), user_id),
    )


def list_users() -> list[dict]:
    return _query(
        "SELECT id, email, full_name, role, is_active, created_at, last_login_at "
        "FROM users WHERE deleted_at IS NULL ORDER BY created_at"
    )


def set_user_active(user_id: str, active: bool) -> None:
    _execute("UPDATE users SET is_active = ? WHERE id = ?", (1 if active else 0, user_id))


# ---------------------------------------------------------------------------
# POs
# ---------------------------------------------------------------------------

def _list_lines(po_id: str) -> list[dict]:
    return _query(
        "SELECT * FROM line_items WHERE po_id = ? AND deleted_at IS NULL ORDER BY line",
        (po_id,),
    )


def _row_to_po(row: dict, lines: list[dict]) -> dict:
    out = dict(row)
    out["line_items"] = lines
    return out


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

    pos = _query(sql, params)
    if not pos:
        return []

    placeholders = ",".join("?" for _ in pos)
    lines = _query(
        f"SELECT * FROM line_items WHERE po_id IN ({placeholders}) ORDER BY line",
        [p["id"] for p in pos],
    )
    lines_by_po: dict[str, list[dict]] = {}
    for ln in lines:
        lines_by_po.setdefault(ln["po_id"], []).append(ln)

    return [_row_to_po(p, lines_by_po.get(p["id"], [])) for p in pos]


def get_po(po_id: str) -> dict | None:
    rows = _query("SELECT * FROM pos WHERE id = ? AND deleted_at IS NULL", (po_id,))
    if not rows:
        return None
    return _row_to_po(rows[0], _list_lines(po_id))


def find_by_po_number(po_number: str) -> dict | None:
    if not po_number:
        return None
    rows = _query(
        "SELECT * FROM pos WHERE po_number = ? AND deleted_at IS NULL ORDER BY added_at DESC LIMIT 1",
        (po_number.strip(),),
    )
    if not rows:
        return None
    return _row_to_po(rows[0], _list_lines(rows[0]["id"]))


def _insert_line_items(po_id: str, items: Iterable[dict]) -> None:
    cur = _conn().cursor()
    for it in items:
        cur.execute(
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
    _conn().commit()


def create_po(data: dict, *, created_by_id: str | None = None, created_by_email: str | None = None) -> dict:
    po_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    line_items = data.get("line_items") or []

    _execute(
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
    _insert_line_items(po_id, line_items)
    return get_po(po_id)


def update_po(po_id: str, data: dict, *, updated_by_id: str | None = None, updated_by_email: str | None = None) -> dict | None:
    existing = _query("SELECT 1 AS x FROM pos WHERE id = ?", (po_id,))
    if not existing:
        return None
    now = datetime.now().isoformat()
    line_items = data.get("line_items") or []

    _execute(
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
            now,
            po_id,
        ),
    )
    _execute("DELETE FROM line_items WHERE po_id = ?", (po_id,))
    _insert_line_items(po_id, line_items)
    return get_po(po_id)


def delete_po(po_id: str) -> bool:
    """Soft-delete (sets deleted_at). Lets sync propagate the tombstone."""
    now = datetime.now().isoformat()
    _execute("UPDATE line_items SET deleted_at = ? WHERE po_id = ?", (now, po_id))
    rows = _execute("UPDATE pos SET deleted_at = ?, updated_at = ? WHERE id = ?", (now, now, po_id))
    return rows > 0


def mark_source_stored(po_id: str, has_source: bool = True) -> None:
    _execute(
        "UPDATE pos SET has_source = ? WHERE id = ?",
        (1 if has_source else 0, po_id),
    )


def clear_all() -> int:
    rows = _query("SELECT COUNT(*) AS c FROM pos")
    n = int(rows[0]["c"]) if rows else 0
    _execute("DELETE FROM line_items")
    _execute("DELETE FROM pos")
    return n


def list_distinct(field: str) -> list[str]:
    if field not in {"customer", "supplier", "buyer", "payment_terms"}:
        return []
    rows = _query(
        f"SELECT DISTINCT {field} AS v FROM pos WHERE {field} IS NOT NULL AND {field} <> '' ORDER BY {field}"
    )
    return [r["v"] for r in rows]


def stats() -> dict:
    po_row = _query(
        "SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS t FROM pos WHERE deleted_at IS NULL"
    )[0]
    line_row = _query("SELECT COUNT(*) AS c FROM line_items WHERE deleted_at IS NULL")[0]
    suppliers = _query(
        "SELECT COUNT(DISTINCT supplier) AS c FROM pos WHERE supplier <> '' AND deleted_at IS NULL"
    )[0]
    active = _query("SELECT COUNT(*) AS c FROM users WHERE is_active = 1 AND deleted_at IS NULL")[0]
    return {
        "po_count": int(po_row["c"] or 0),
        "total_value": float(po_row["t"] or 0),
        "line_count": int(line_row["c"] or 0),
        "supplier_count": int(suppliers["c"] or 0),
        "active_user_count": int(active["c"] or 0),
    }


# ---------------------------------------------------------------------------
# Sync helpers — used by sync_engine.py. These bypass deleted_at filtering
# so the sync layer sees tombstones too.
# ---------------------------------------------------------------------------

def pos_since(since_iso: str | None = None) -> list[dict]:
    """All POs (incl. tombstoned) where updated_at > since_iso."""
    if since_iso:
        return _query("SELECT * FROM pos WHERE updated_at > ?", (since_iso,))
    return _query("SELECT * FROM pos")


def line_items_for_pos(po_ids: list[str]) -> list[dict]:
    if not po_ids:
        return []
    placeholders = ",".join("?" for _ in po_ids)
    return _query(f"SELECT * FROM line_items WHERE po_id IN ({placeholders})", po_ids)


def users_since(since_iso: str | None = None) -> list[dict]:
    """All users (incl. tombstoned) where (last_login_at or created_at) > since_iso."""
    if since_iso:
        return _query(
            "SELECT * FROM users WHERE COALESCE(last_login_at, created_at) > ? OR deleted_at > ?",
            (since_iso, since_iso),
        )
    return _query("SELECT * FROM users")


def upsert_user(record: dict) -> None:
    """Insert or blind-overwrite a user row by id. Used by migration scripts."""
    cur = _conn().cursor()
    cur.execute("DELETE FROM users WHERE id = ?", (record["id"],))
    cur.execute(
        """INSERT INTO users (id, email, full_name, password_hash, role, is_active, created_at, last_login_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            record["id"], record["email"], record.get("full_name") or "",
            record["password_hash"], record.get("role") or "rep",
            1 if record.get("is_active", True) else 0,
            record["created_at"], record.get("last_login_at"),
            record.get("deleted_at"),
        ),
    )
    _conn().commit()


def upsert_user_lww(record: dict) -> str:
    """LWW upsert from sync — only overwrites remote if our last_login_at/created_at
    is >= remote's. Returns 'inserted', 'updated', or 'kept_remote'."""
    cur = _conn().cursor()
    existing = cur.execute(
        "SELECT last_login_at, created_at FROM users WHERE id = ?",
        (record["id"],),
    ).fetchall()
    incoming_ts = record.get("last_login_at") or record.get("created_at") or ""
    if existing:
        # libsql cursor returns tuples
        row = existing[0]
        # row could be a tuple — extract by index
        remote_ts = (row[0] if row[0] else row[1]) or ""
        if remote_ts > incoming_ts:
            return "kept_remote"
        cur.execute("DELETE FROM users WHERE id = ?", (record["id"],))
        verb = "updated"
    else:
        verb = "inserted"
    cur.execute(
        """INSERT INTO users (id, email, full_name, password_hash, role, is_active, created_at, last_login_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            record["id"], record["email"], record.get("full_name") or "",
            record["password_hash"], record.get("role") or "rep",
            1 if record.get("is_active", True) else 0,
            record["created_at"], record.get("last_login_at"),
            record.get("deleted_at"),
        ),
    )
    _conn().commit()
    return verb


def upsert_po_full_lww(po: dict, line_items: list[dict]) -> str:
    """LWW upsert from sync. Only overwrites remote if our `updated_at` >= remote's.
    Returns 'inserted' | 'updated' | 'kept_remote'."""
    cur = _conn().cursor()
    existing = cur.execute(
        "SELECT updated_at FROM pos WHERE id = ?",
        (po["id"],),
    ).fetchall()
    incoming_ts = po.get("updated_at") or ""
    if existing:
        remote_ts = existing[0][0] or ""
        if remote_ts > incoming_ts:
            return "kept_remote"
        cur.execute("DELETE FROM pos WHERE id = ?", (po["id"],))
        cur.execute("DELETE FROM line_items WHERE po_id = ?", (po["id"],))
        verb = "updated"
    else:
        verb = "inserted"
    _insert_po_with_lines(cur, po, line_items)
    _conn().commit()
    return verb


def _insert_po_with_lines(cur, po: dict, line_items: list[dict]) -> None:
    cur.execute(
        """INSERT INTO pos (id, po_number, po_date, revision, customer, customer_address,
                            supplier, supplier_address, bill_to, ship_to, payment_terms,
                            buyer, buyer_email, currency, total, filename, notes, status,
                            has_source, extraction_method,
                            created_by_id, created_by_email,
                            updated_by_id, updated_by_email,
                            added_at, updated_at, deleted_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            po["id"], po.get("po_number") or "", po.get("po_date") or "",
            po.get("revision") or "", po.get("customer") or "",
            po.get("customer_address") or "", po.get("supplier") or "",
            po.get("supplier_address") or "", po.get("bill_to") or "",
            po.get("ship_to") or "", po.get("payment_terms") or "",
            po.get("buyer") or "", po.get("buyer_email") or "",
            po.get("currency") or "USD", float(po.get("total") or 0),
            po.get("filename") or "", po.get("notes") or "",
            po.get("status") or "received",
            int(po.get("has_source") or 0),
            po.get("extraction_method") or "text",
            po.get("created_by_id"), po.get("created_by_email"),
            po.get("updated_by_id"), po.get("updated_by_email"),
            po.get("added_at") or datetime.now().isoformat(),
            po.get("updated_at") or datetime.now().isoformat(),
            po.get("deleted_at"),
        ),
    )
    for it in line_items or []:
        cur.execute(
            """INSERT INTO line_items
               (id, po_id, line, customer_part, vendor_part, description,
                quantity, uom, unit_price, amount, required_date, deleted_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                it.get("id") or str(uuid.uuid4()), po["id"], int(it.get("line") or 0),
                it.get("customer_part") or "", it.get("vendor_part") or "",
                it.get("description") or "", float(it.get("quantity") or 0),
                it.get("uom") or "EA", float(it.get("unit_price") or 0),
                float(it.get("amount") or 0), it.get("required_date") or "",
                it.get("deleted_at"),
            ),
        )


def upsert_po_full(po: dict, line_items: list[dict]) -> None:
    """Insert or BLIND overwrite a PO + its line items. Used by migration scripts.
    Production sync uses upsert_po_full_lww."""
    cur = _conn().cursor()
    cur.execute("DELETE FROM pos WHERE id = ?", (po["id"],))
    cur.execute("DELETE FROM line_items WHERE po_id = ?", (po["id"],))
    cur.execute(
        """INSERT INTO pos (id, po_number, po_date, revision, customer, customer_address,
                            supplier, supplier_address, bill_to, ship_to, payment_terms,
                            buyer, buyer_email, currency, total, filename, notes, status,
                            has_source, extraction_method,
                            created_by_id, created_by_email,
                            updated_by_id, updated_by_email,
                            added_at, updated_at, deleted_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            po["id"], po.get("po_number") or "", po.get("po_date") or "",
            po.get("revision") or "", po.get("customer") or "",
            po.get("customer_address") or "", po.get("supplier") or "",
            po.get("supplier_address") or "", po.get("bill_to") or "",
            po.get("ship_to") or "", po.get("payment_terms") or "",
            po.get("buyer") or "", po.get("buyer_email") or "",
            po.get("currency") or "USD", float(po.get("total") or 0),
            po.get("filename") or "", po.get("notes") or "",
            po.get("status") or "received",
            int(po.get("has_source") or 0),
            po.get("extraction_method") or "text",
            po.get("created_by_id"), po.get("created_by_email"),
            po.get("updated_by_id"), po.get("updated_by_email"),
            po.get("added_at") or datetime.now().isoformat(),
            po.get("updated_at") or datetime.now().isoformat(),
            po.get("deleted_at"),
        ),
    )
    for it in line_items or []:
        cur.execute(
            """INSERT INTO line_items
               (id, po_id, line, customer_part, vendor_part, description,
                quantity, uom, unit_price, amount, required_date, deleted_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                it.get("id") or str(uuid.uuid4()), po["id"], int(it.get("line") or 0),
                it.get("customer_part") or "", it.get("vendor_part") or "",
                it.get("description") or "", float(it.get("quantity") or 0),
                it.get("uom") or "EA", float(it.get("unit_price") or 0),
                float(it.get("amount") or 0), it.get("required_date") or "",
                it.get("deleted_at"),
            ),
        )
    _conn().commit()


# ---------------------------------------------------------------------------
# Compatibility shim
# ---------------------------------------------------------------------------

class _FakeCursor:
    def __init__(self, rows): self._rows = rows
    def fetchall(self): return self._rows
    def fetchone(self): return self._rows[0] if self._rows else None


class _FakeConn:
    def execute(self, sql: str, params: tuple = ()):
        return _FakeCursor(_query(sql, params))


@contextmanager
def get_conn():
    yield _FakeConn()
