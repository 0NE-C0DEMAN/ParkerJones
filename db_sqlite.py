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
import re
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
-- list_pos sorts by updated_at; Directory + Reports + Ledger all hit this
CREATE INDEX IF NOT EXISTS idx_pos_updated_at ON pos(updated_at DESC);
-- supplier rollups (Directory + Reports) sort/group on supplier
CREATE INDEX IF NOT EXISTS idx_pos_supplier ON pos(supplier);

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

-- Generic key/value table for runtime admin-managed settings.
-- Currently used for: llm_api_key (admin can rotate without touching HF
-- Space secrets). Pattern accommodates future toggles without schema churn.
CREATE TABLE IF NOT EXISTS app_config (
  key           TEXT PRIMARY KEY,
  value         TEXT,
  updated_at    TEXT,
  updated_by_id TEXT
);

-- Saved filters (Ledger smart folders). Stored as JSON so the filter
-- shape can evolve without schema changes. Two visibility modes:
--   * scope='user'   → only owner_id sees the filter
--   * scope='team'   → everyone on the workspace sees it (admin-created)
CREATE TABLE IF NOT EXISTS saved_filters (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  emoji       TEXT,
  payload     TEXT NOT NULL,     -- JSON: {query?, status?, period?, customer?, ...}
  scope       TEXT NOT NULL DEFAULT 'user',  -- 'user' | 'team'
  owner_id    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_saved_filters_owner ON saved_filters(owner_id);

-- Personal API keys for programmatic access. Stored hashed (bcrypt) so a
-- DB leak doesn't reveal usable credentials. `prefix` is the first 8
-- chars of the cleartext key — displayed in the UI as "fdr_aBc12345…"
-- so the owner can recognize which key is which without seeing the
-- secret value.
CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,             -- first 8 chars of the key, for display
  key_hash     TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix);
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
    # Expanded schema — see backend.PORecord. Added to cover fields that
    # appear on real-world POs (Ariba/Wesco/Cooper templates) but were
    # missing in v0.4. ALTER TABLE ADD COLUMN is safe on SQLite for
    # existing rows (NULL defaults).
    ("supplier_code", "TEXT"),
    ("buyer_phone", "TEXT"),
    ("receiving_contact", "TEXT"),
    ("receiving_contact_phone", "TEXT"),
    ("freight_terms", "TEXT"),
    ("ship_via", "TEXT"),
    ("fob_terms", "TEXT"),
    ("quote_number", "TEXT"),
    ("contract_number", "TEXT"),
]

USER_MIGRATIONS = [
    ("deleted_at", "TEXT"),
]

LINE_ITEM_MIGRATIONS = [
    ("deleted_at", "TEXT"),
    # Per-line special instructions ("30 PER PALLET", "Ship by ...", etc.)
    ("notes", "TEXT"),
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
    # Excludes soft-deleted accounts so a "parked" email (deleted-*) can't
    # be used to log in, and the slot is genuinely free for re-creation.
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE email = ? AND deleted_at IS NULL",
            (email.strip().lower(),),
        ).fetchone()
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
    # Soft-deleted users are hidden from every UI listing — only the row
    # itself (and its POs' created_by_email audit string) remain in the DB.
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, email, full_name, role, is_active, created_at, last_login_at "
            "FROM users WHERE deleted_at IS NULL ORDER BY created_at"
        ).fetchall()
        return [dict(r) for r in rows]


def set_user_active(user_id: str, active: bool) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE users SET is_active = ? WHERE id = ?", (1 if active else 0, user_id))


def delete_user(user_id: str) -> bool:
    """Soft-delete: keep the row (and its audit references on POs) but
    mark it deleted, deactivate it, and rename the email so a fresh
    account can be created with the same address. Returns True if a row
    was actually deleted (False if no such user or already deleted)."""
    now = datetime.now().isoformat()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT email, deleted_at FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        if not row or row["deleted_at"]:
            return False
        # Park the original email under a deleted-* prefix so the slot frees
        # up. POs' created_by_email string keeps the original — audit
        # trail intact.
        parked_email = f"deleted-{user_id[:8]}-{row['email']}"
        conn.execute(
            "UPDATE users SET deleted_at = ?, is_active = 0, email = ? WHERE id = ?",
            (now, parked_email, user_id),
        )
        return True


def update_user_email(user_id: str, new_email: str) -> dict | None:
    """Change a user's email. Raises ValueError if the address is already
    taken by another (non-deleted) account."""
    norm = (new_email or "").strip().lower()
    if not norm:
        raise ValueError("Email cannot be empty.")
    with get_conn() as conn:
        clash = conn.execute(
            "SELECT id FROM users WHERE email = ? AND id != ? AND deleted_at IS NULL",
            (norm, user_id),
        ).fetchone()
        if clash:
            raise ValueError(f"Another account already uses {norm}.")
        conn.execute("UPDATE users SET email = ? WHERE id = ?", (norm, user_id))
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


# =============================================================================
# POs
# =============================================================================

# Columns that were added later via ALTER TABLE without a NOT NULL DEFAULT,
# so older rows may have NULL there. The Pydantic PORecord model declares
# them as `str = ""` and will 500 on validation if it gets None. Coalesce
# defensively at the row-read boundary so the API never has to think about
# this drift between the SQLite schema and the wire model.
_PO_NULLABLE_STR_COLS = (
    "po_date", "revision", "customer", "customer_address",
    "supplier", "supplier_code", "supplier_address",
    "bill_to", "ship_to",
    "payment_terms", "freight_terms", "ship_via", "fob_terms",
    "buyer", "buyer_email", "buyer_phone",
    "receiving_contact", "receiving_contact_phone",
    "quote_number", "contract_number",
    "currency", "filename", "notes", "status", "extraction_method",
    "created_by_id", "created_by_email",
    "updated_by_id", "updated_by_email",
)
_LINE_NULLABLE_STR_COLS = (
    "customer_part", "vendor_part", "description",
    "uom", "required_date", "notes",
)
# Numeric columns that can be NULL in older rows (the LLM may have
# skipped quantity/unit_price/amount on a stray line). Pydantic models
# them as `float = 0` — None would 500. Coalesce NULL → 0 here so the
# API returns clean numbers and the UI doesn't render blank cells.
_PO_NULLABLE_NUM_COLS = ("total", "has_source")
_LINE_NULLABLE_NUM_COLS = ("line", "quantity", "unit_price", "amount")


def _coalesce_strs(d: dict, cols) -> dict:
    for c in cols:
        if d.get(c) is None:
            d[c] = ""
    return d


def _coalesce_nums(d: dict, cols) -> dict:
    for c in cols:
        if d.get(c) is None:
            d[c] = 0
    return d


def _row_to_po(row: sqlite3.Row, line_items: list[dict]) -> dict:
    d = dict(row)
    _coalesce_strs(d, _PO_NULLABLE_STR_COLS)
    _coalesce_nums(d, _PO_NULLABLE_NUM_COLS)
    d["line_items"] = line_items
    return d


def _list_lines(conn: sqlite3.Connection, po_id: str) -> list[dict]:
    cur = conn.execute(
        "SELECT * FROM line_items WHERE po_id = ? ORDER BY line",
        (po_id,),
    )
    out = []
    for r in cur.fetchall():
        d = dict(r)
        _coalesce_strs(d, _LINE_NULLABLE_STR_COLS)
        _coalesce_nums(d, _LINE_NULLABLE_NUM_COLS)
        out.append(d)
    return out


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


_NUM_RE = re.compile(r"-?\d+(?:[.,]\d+)?")


def _safe_float(v) -> float:
    """Tolerant number parse — survives the LLM occasionally returning
    "450 EA", "1,500.00", or a stray currency symbol where the schema
    asks for a plain number. Returns 0.0 if nothing numeric is found."""
    if v is None or v == "":
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "")
    try:
        return float(s)
    except (TypeError, ValueError):
        m = _NUM_RE.search(s)
        if m:
            try:
                return float(m.group(0).replace(",", ""))
            except (TypeError, ValueError):
                return 0.0
        return 0.0


def _safe_int(v) -> int:
    return int(_safe_float(v))


def _insert_line_items(conn: sqlite3.Connection, po_id: str, items: Iterable[dict]) -> None:
    # `enumerate` provides a guaranteed line number even if the LLM omits
    # it or returns 0 — a rep should never see a blank `#` cell.
    for idx, it in enumerate(items, start=1):
        # Try to keep an LLM-provided line number if it's a real positive
        # integer; otherwise fall back to positional index.
        line_num = _safe_int(it.get("line"))
        if line_num <= 0:
            line_num = idx
        conn.execute(
            """
            INSERT INTO line_items (id, po_id, line, customer_part, vendor_part,
                                    description, quantity, uom, unit_price, amount,
                                    required_date, notes)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                str(uuid.uuid4()),
                po_id,
                line_num,
                str(it.get("customer_part") or ""),
                str(it.get("vendor_part") or ""),
                str(it.get("description") or ""),
                _safe_float(it.get("quantity")),
                str(it.get("uom") or "EA"),
                _safe_float(it.get("unit_price")),
                _safe_float(it.get("amount")),
                str(it.get("required_date") or ""),
                str(it.get("notes") or ""),
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
                             supplier, supplier_code, supplier_address, bill_to, ship_to,
                             payment_terms, freight_terms, ship_via, fob_terms,
                             buyer, buyer_email, buyer_phone,
                             receiving_contact, receiving_contact_phone,
                             quote_number, contract_number,
                             currency, total, filename, notes, status,
                             extraction_method,
                             created_by_id, created_by_email,
                             updated_by_id, updated_by_email,
                             added_at, updated_at)
            VALUES (?,?,?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?,?, ?,?, ?,?, ?,?,?,?,?, ?, ?,?, ?,?, ?,?)
            """,
            (
                po_id,
                str(data.get("po_number") or ""),
                str(data.get("po_date") or ""),
                str(data.get("revision") or ""),
                str(data.get("customer") or ""),
                str(data.get("customer_address") or ""),
                str(data.get("supplier") or ""),
                str(data.get("supplier_code") or ""),
                str(data.get("supplier_address") or ""),
                str(data.get("bill_to") or ""),
                str(data.get("ship_to") or ""),
                str(data.get("payment_terms") or ""),
                str(data.get("freight_terms") or ""),
                str(data.get("ship_via") or ""),
                str(data.get("fob_terms") or ""),
                str(data.get("buyer") or ""),
                str(data.get("buyer_email") or ""),
                str(data.get("buyer_phone") or ""),
                str(data.get("receiving_contact") or ""),
                str(data.get("receiving_contact_phone") or ""),
                str(data.get("quote_number") or ""),
                str(data.get("contract_number") or ""),
                str(data.get("currency") or "USD"),
                _safe_float(data.get("total")),
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
                           supplier=?, supplier_code=?, supplier_address=?,
                           bill_to=?, ship_to=?,
                           payment_terms=?, freight_terms=?, ship_via=?, fob_terms=?,
                           buyer=?, buyer_email=?, buyer_phone=?,
                           receiving_contact=?, receiving_contact_phone=?,
                           quote_number=?, contract_number=?,
                           currency=?, total=?, filename=?, notes=?,
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
                str(data.get("supplier_code") or ""),
                str(data.get("supplier_address") or ""),
                str(data.get("bill_to") or ""),
                str(data.get("ship_to") or ""),
                str(data.get("payment_terms") or ""),
                str(data.get("freight_terms") or ""),
                str(data.get("ship_via") or ""),
                str(data.get("fob_terms") or ""),
                str(data.get("buyer") or ""),
                str(data.get("buyer_email") or ""),
                str(data.get("buyer_phone") or ""),
                str(data.get("receiving_contact") or ""),
                str(data.get("receiving_contact_phone") or ""),
                str(data.get("quote_number") or ""),
                str(data.get("contract_number") or ""),
                str(data.get("currency") or "USD"),
                _safe_float(data.get("total")),
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


# =============================================================================
# Directory — aggregate views of customers and suppliers, built from PO history.
# Cheap on-the-fly queries; no separate tables to keep in sync.
# =============================================================================

def _party_summary(field: str) -> list[dict]:
    """Group POs by `customer` or `supplier` and return one row per party
    with count, lifetime spend, and date range. Skips blanks. Sorted by
    total spend descending so the biggest accounts surface first."""
    if field not in ("customer", "supplier"):
        raise ValueError(f"Invalid party field: {field}")
    with get_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT {field} AS name,
                   COUNT(*)               AS po_count,
                   COALESCE(SUM(total),0) AS total_spend,
                   MIN(po_date)           AS first_po_date,
                   MAX(po_date)           AS last_po_date,
                   MAX(updated_at)        AS last_activity
            FROM pos
            WHERE {field} IS NOT NULL AND {field} <> ''
            GROUP BY {field}
            ORDER BY total_spend DESC
            """
        ).fetchall()
        return [
            {
                "name":          r["name"],
                "po_count":      r["po_count"] or 0,
                "total_spend":   float(r["total_spend"] or 0),
                "first_po_date": r["first_po_date"] or "",
                "last_po_date":  r["last_po_date"] or "",
                "last_activity": r["last_activity"] or "",
            }
            for r in rows
        ]


def list_customers() -> list[dict]:
    return _party_summary("customer")


def list_suppliers() -> list[dict]:
    return _party_summary("supplier")


def list_pos_by_party(field: str, name: str) -> list[dict]:
    """Return every PO where customer = name (or supplier = name).
    Same shape as list_pos so the UI can render the same row component."""
    if field not in ("customer", "supplier"):
        raise ValueError(f"Invalid party field: {field}")
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM pos WHERE {field} = ? ORDER BY po_date DESC, updated_at DESC",
            (name,),
        ).fetchall()
        return [_row_to_po(r, _list_lines(conn, r["id"])) for r in rows]


# =============================================================================
# Smart dedup — score every existing PO for similarity to a new extraction
# and return the top candidates. Strict PO# matches always rank highest;
# weaker signals (same customer + total + close date, line-item overlap)
# surface revisions that don't share a PO number.
# =============================================================================

def find_similar_pos(
    *,
    po_number: str = "",
    customer: str = "",
    total: float = 0.0,
    po_date: str = "",
    line_items: list[dict] | None = None,
    limit: int = 3,
) -> list[dict]:
    line_items = line_items or []
    new_total = float(total or 0)
    new_descs = [
        (it.get("description") or "").strip().lower()
        for it in line_items
        if (it.get("description") or "").strip()
    ]

    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM pos ORDER BY updated_at DESC LIMIT 400").fetchall()
        candidates = []
        for r in rows:
            score = 0.0
            reasons = []
            same_pn      = po_number and r["po_number"] == po_number
            same_cust    = customer  and r["customer"]  == customer
            close_total  = new_total > 0 and r["total"] and abs((r["total"] or 0) - new_total) <= max(1.0, new_total * 0.01)
            close_date   = po_date and r["po_date"] and _date_within(po_date, r["po_date"], days=14)

            if same_pn and same_cust:
                score = 1.0
                reasons.append("Same PO # and customer")
            elif same_pn:
                score = 0.95
                reasons.append("Same PO #")
            elif same_cust and close_total and close_date:
                score = 0.75
                reasons.append("Same customer · same total · within 14 days")
            elif same_cust and close_total:
                score = 0.65
                reasons.append("Same customer · same total")

            # Line-item overlap nudges the score up for the soft matches.
            if new_descs and score > 0:
                existing = [
                    (li["description"] or "").strip().lower()
                    for li in _list_lines(conn, r["id"])
                    if (li["description"] or "").strip()
                ]
                if existing:
                    overlap = len(set(new_descs) & set(existing)) / max(len(new_descs), len(existing))
                    if overlap >= 0.6:
                        score = min(1.0, score + 0.1)
                        reasons.append(f"{int(overlap * 100)}% line-item overlap")

            if score >= 0.6:
                rec = _row_to_po(r, _list_lines(conn, r["id"]))
                rec["_match_score"]   = round(score, 3)
                rec["_match_reasons"] = reasons
                candidates.append(rec)

        candidates.sort(key=lambda c: c["_match_score"], reverse=True)
        return candidates[:limit]


# =============================================================================
# Saved filters / smart folders
# =============================================================================

def list_saved_filters(user_id: str) -> list[dict]:
    """Return every filter the user can see — their own + team-shared ones."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM saved_filters "
            "WHERE owner_id = ? OR scope = 'team' "
            "ORDER BY created_at",
            (user_id,),
        ).fetchall()
        return [_row_to_filter(r, user_id) for r in rows]


def _row_to_filter(row, current_user_id: str) -> dict:
    import json as _json
    d = dict(row)
    try:
        d["payload"] = _json.loads(d.get("payload") or "{}")
    except (TypeError, ValueError):
        d["payload"] = {}
    d["mine"] = d.get("owner_id") == current_user_id
    return d


def create_saved_filter(
    *,
    name: str,
    emoji: str,
    payload: dict,
    scope: str,
    owner_id: str,
) -> dict:
    import json as _json
    if scope not in ("user", "team"):
        scope = "user"
    fid = str(uuid.uuid4())
    now = datetime.now().isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO saved_filters (id, name, emoji, payload, scope, owner_id, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (fid, name, emoji or "", _json.dumps(payload or {}), scope, owner_id, now, now),
        )
        row = conn.execute("SELECT * FROM saved_filters WHERE id = ?", (fid,)).fetchone()
        return _row_to_filter(row, owner_id) if row else {}


def update_saved_filter(
    filter_id: str,
    *,
    user_id: str,
    is_admin: bool,
    name: str | None = None,
    emoji: str | None = None,
    payload: dict | None = None,
    scope: str | None = None,
) -> dict | None:
    """Owner can edit their own filter. Admin can edit any team-scope filter."""
    import json as _json
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM saved_filters WHERE id = ?", (filter_id,)).fetchone()
        if not row:
            return None
        # Permissions: owner OR (admin AND team-scope).
        if row["owner_id"] != user_id and not (is_admin and row["scope"] == "team"):
            return None
        sets, params = [], []
        if name is not None:    sets.append("name = ?");    params.append(name)
        if emoji is not None:   sets.append("emoji = ?");   params.append(emoji)
        if payload is not None: sets.append("payload = ?"); params.append(_json.dumps(payload))
        if scope is not None and scope in ("user", "team"):
            sets.append("scope = ?"); params.append(scope)
        if not sets:
            return _row_to_filter(row, user_id)
        sets.append("updated_at = ?"); params.append(datetime.now().isoformat())
        params.append(filter_id)
        conn.execute(f"UPDATE saved_filters SET {', '.join(sets)} WHERE id = ?", params)
        row = conn.execute("SELECT * FROM saved_filters WHERE id = ?", (filter_id,)).fetchone()
        return _row_to_filter(row, user_id) if row else None


def delete_saved_filter(filter_id: str, *, user_id: str, is_admin: bool) -> bool:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM saved_filters WHERE id = ?", (filter_id,)).fetchone()
        if not row:
            return False
        if row["owner_id"] != user_id and not (is_admin and row["scope"] == "team"):
            return False
        conn.execute("DELETE FROM saved_filters WHERE id = ?", (filter_id,))
        return True


# =============================================================================
# API keys — personal access tokens for programmatic API use.
# =============================================================================

def list_api_keys(user_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, user_id, name, prefix, created_at, last_used_at, revoked_at "
            "FROM api_keys WHERE user_id = ? AND revoked_at IS NULL "
            "ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def create_api_key(*, user_id: str, name: str, prefix: str, key_hash: str) -> dict:
    kid = str(uuid.uuid4())
    now = datetime.now().isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO api_keys (id, user_id, name, prefix, key_hash, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (kid, user_id, name, prefix, key_hash, now),
        )
        row = conn.execute(
            "SELECT id, user_id, name, prefix, created_at, last_used_at, revoked_at "
            "FROM api_keys WHERE id = ?",
            (kid,),
        ).fetchone()
        return dict(row) if row else {}


def revoke_api_key(key_id: str, *, user_id: str) -> bool:
    now = datetime.now().isoformat()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT user_id, revoked_at FROM api_keys WHERE id = ?",
            (key_id,),
        ).fetchone()
        if not row or row["user_id"] != user_id or row["revoked_at"]:
            return False
        conn.execute("UPDATE api_keys SET revoked_at = ? WHERE id = ?", (now, key_id))
        return True


def find_api_key_by_prefix(prefix: str) -> list[dict]:
    """Return every non-revoked key whose prefix matches. The caller still
    needs to verify the full key against `key_hash` (multiple keys could
    share a prefix in theory)."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM api_keys WHERE prefix = ? AND revoked_at IS NULL",
            (prefix,),
        ).fetchall()
        return [dict(r) for r in rows]


def touch_api_key_used(key_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE api_keys SET last_used_at = ? WHERE id = ?",
            (datetime.now().isoformat(), key_id),
        )


def _date_within(a: str, b: str, days: int) -> bool:
    """True iff two ISO-ish date strings are within `days` of each other.
    Tolerates malformed values by returning False."""
    try:
        da = datetime.fromisoformat(a[:10])
        db = datetime.fromisoformat(b[:10])
        return abs((da - db).days) <= days
    except (TypeError, ValueError):
        return False


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


# =============================================================================
# App config (admin-managed key/value)
# =============================================================================

def get_config(key: str) -> str | None:
    """Return the stored value for `key`, or None if not set (or empty)."""
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM app_config WHERE key = ?", (key,)).fetchone()
    if not row:
        return None
    val = row["value"]
    return val if val else None


def set_config(key: str, value: str | None, updated_by_id: str | None = None) -> None:
    """Upsert a config value. Pass value=None to clear (we delete the row so
    callers can distinguish unset from empty-string)."""
    now = datetime.now().isoformat()
    with get_conn() as conn:
        if value is None or value == "":
            conn.execute("DELETE FROM app_config WHERE key = ?", (key,))
        else:
            conn.execute(
                """INSERT INTO app_config (key, value, updated_at, updated_by_id)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(key) DO UPDATE SET
                     value = excluded.value,
                     updated_at = excluded.updated_at,
                     updated_by_id = excluded.updated_by_id""",
                (key, value, now, updated_by_id),
            )


def delete_config(key: str) -> None:
    set_config(key, None)
