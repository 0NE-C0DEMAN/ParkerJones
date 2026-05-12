"""
db_sheets.py — Google Sheets storage backend for Foundry.

Mirrors the public interface of db_sqlite.py so that backend.py / auth.py
can swap backends transparently by setting FOUNDRY_DB_BACKEND=sheets.

Layout in the spreadsheet:
    Tab "POs"        — one row per purchase order
    Tab "LineItems"  — one row per line item (FK po_id → POs.id)
    Tab "Users"      — one row per registered account

Auth: a service account whose JSON credentials live in
.streamlit/secrets.toml under [gcp_service_account].

Reads are cached in-memory for 30 s to keep the UI snappy; writes invalidate
the cache.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

import gspread
from google.oauth2.service_account import Credentials

# ---------------------------------------------------------------------------
# Configuration & credentials
# ---------------------------------------------------------------------------

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]

SECRETS_PATH = Path(__file__).parent / ".streamlit" / "secrets.toml"

_CACHE_TTL_SECONDS = 30
_cache: dict = {}
_cache_lock = threading.Lock()


def _load_secrets() -> dict:
    """Read .streamlit/secrets.toml (preferring env vars when set)."""
    secrets: dict[str, Any] = {}
    if SECRETS_PATH.exists():
        try:
            if sys.version_info >= (3, 11):
                import tomllib
                with SECRETS_PATH.open("rb") as f:
                    secrets = tomllib.load(f)
            else:
                import tomli  # type: ignore
                with SECRETS_PATH.open("rb") as f:
                    secrets = tomli.load(f)
        except Exception as e:
            print(f"[db_sheets] Failed to parse secrets.toml: {e}", file=sys.stderr)
    return secrets


def _sheet_id() -> str:
    sid = os.environ.get("FOUNDRY_SHEET_ID")
    if sid:
        return sid
    secrets = _load_secrets()
    sid = secrets.get("FOUNDRY_SHEET_ID")
    if not sid:
        raise RuntimeError(
            "FOUNDRY_SHEET_ID is not set. Add it to .streamlit/secrets.toml or set "
            "as an environment variable."
        )
    return sid


def _service_account_info() -> dict:
    env_json = os.environ.get("FOUNDRY_GCP_SERVICE_ACCOUNT_JSON")
    if env_json:
        return json.loads(env_json)
    secrets = _load_secrets()
    info = secrets.get("gcp_service_account")
    if not info:
        raise RuntimeError(
            "Service account credentials are missing. Add a [gcp_service_account] "
            "section to .streamlit/secrets.toml with the full JSON contents from "
            "Google Cloud Console."
        )
    return dict(info)


_client_lock = threading.Lock()
_client_cache: dict[str, Any] = {}


def _client() -> gspread.Client:
    with _client_lock:
        if "client" not in _client_cache:
            creds = Credentials.from_service_account_info(
                _service_account_info(), scopes=SCOPES
            )
            _client_cache["client"] = gspread.authorize(creds)
        return _client_cache["client"]


def _spreadsheet() -> gspread.Spreadsheet:
    with _client_lock:
        if "spreadsheet" not in _client_cache:
            _client_cache["spreadsheet"] = _client().open_by_key(_sheet_id())
        return _client_cache["spreadsheet"]


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

PO_HEADERS = [
    "id", "po_number", "po_date", "revision",
    "customer", "customer_address",
    "supplier", "supplier_address",
    "bill_to", "ship_to",
    "payment_terms", "buyer", "buyer_email",
    "currency", "total", "filename", "notes",
    "status", "has_source", "extraction_method",
    "created_by_id", "created_by_email",
    "updated_by_id", "updated_by_email",
    "added_at", "updated_at",
]

LINE_HEADERS = [
    "id", "po_id", "line",
    "customer_part", "vendor_part", "description",
    "quantity", "uom", "unit_price", "amount", "required_date",
]

USER_HEADERS = [
    "id", "email", "full_name", "password_hash",
    "role", "is_active", "created_at", "last_login_at",
]

TAB_POS = "POs"
TAB_LINES = "LineItems"
TAB_USERS = "Users"


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def _cached(key: str, fn):
    with _cache_lock:
        entry = _cache.get(key)
        if entry and (time.time() - entry["at"]) < _CACHE_TTL_SECONDS:
            return entry["value"]
    value = fn()
    with _cache_lock:
        _cache[key] = {"value": value, "at": time.time()}
    return value


def _invalidate(*keys: str):
    with _cache_lock:
        if not keys:
            _cache.clear()
        else:
            for k in keys:
                _cache.pop(k, None)


# ---------------------------------------------------------------------------
# Init / migrations
# ---------------------------------------------------------------------------

def init() -> None:
    """Idempotently ensure all required tabs + headers exist."""
    sh = _spreadsheet()
    for tab, headers in [(TAB_POS, PO_HEADERS), (TAB_LINES, LINE_HEADERS), (TAB_USERS, USER_HEADERS)]:
        try:
            ws = sh.worksheet(tab)
        except gspread.WorksheetNotFound:
            ws = sh.add_worksheet(title=tab, rows=2000, cols=len(headers))
        existing = ws.row_values(1)
        if existing != headers:
            ws.update("A1", [headers])
            try: ws.freeze(rows=1)
            except Exception: pass
    _invalidate()


# ---------------------------------------------------------------------------
# Sheet-row helpers
# ---------------------------------------------------------------------------

def _records(tab: str) -> list[dict]:
    return _cached(f"records:{tab}", lambda: _spreadsheet().worksheet(tab).get_all_records())


def _row_index(tab: str, key: str, value: Any) -> int | None:
    """1-indexed row number of first row where `key == value` (after header)."""
    rows = _records(tab)
    for i, r in enumerate(rows):
        if str(r.get(key)) == str(value):
            return i + 2  # +1 for 1-indexed, +1 for header row
    return None


def _coerce(value: Any) -> Any:
    """Sheets returns strings for everything; coerce common types."""
    if value == "":
        return ""
    return value


def _row_to_dict(headers: list[str], row: list[Any]) -> dict:
    return {h: _coerce(row[i] if i < len(row) else "") for i, h in enumerate(headers)}


def _build_row(headers: list[str], data: dict) -> list[Any]:
    return [data.get(h, "") for h in headers]


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

def create_user(record: dict) -> None:
    ws = _spreadsheet().worksheet(TAB_USERS)
    row = _build_row(USER_HEADERS, {
        **record,
        "is_active": 1 if record.get("is_active", True) else 0,
        "last_login_at": record.get("last_login_at") or "",
    })
    ws.append_row(row, value_input_option="USER_ENTERED")
    _invalidate(f"records:{TAB_USERS}")


def get_user(user_id: str) -> dict | None:
    for r in _records(TAB_USERS):
        if str(r.get("id")) == str(user_id):
            return _normalize_user(r)
    return None


def find_user_by_email(email: str) -> dict | None:
    email = (email or "").strip().lower()
    for r in _records(TAB_USERS):
        if str(r.get("email", "")).strip().lower() == email:
            return _normalize_user(r)
    return None


def _normalize_user(r: dict) -> dict:
    return {
        "id": r.get("id") or "",
        "email": (r.get("email") or "").strip().lower(),
        "full_name": r.get("full_name") or "",
        "password_hash": r.get("password_hash") or "",
        "role": r.get("role") or "rep",
        "is_active": int(r.get("is_active") or 0),
        "created_at": r.get("created_at") or "",
        "last_login_at": r.get("last_login_at") or "",
    }


def update_user(user_id: str, full_name: str | None = None) -> dict | None:
    row_num = _row_index(TAB_USERS, "id", user_id)
    if row_num is None:
        return None
    if full_name is not None:
        col_idx = USER_HEADERS.index("full_name") + 1  # 1-indexed
        _spreadsheet().worksheet(TAB_USERS).update_cell(row_num, col_idx, full_name)
        _invalidate(f"records:{TAB_USERS}")
    return get_user(user_id)


def set_user_password(user_id: str, password_hash: str) -> None:
    row_num = _row_index(TAB_USERS, "id", user_id)
    if row_num is None:
        return
    col_idx = USER_HEADERS.index("password_hash") + 1
    _spreadsheet().worksheet(TAB_USERS).update_cell(row_num, col_idx, password_hash)
    _invalidate(f"records:{TAB_USERS}")


def touch_last_login(user_id: str) -> None:
    row_num = _row_index(TAB_USERS, "id", user_id)
    if row_num is None:
        return
    col_idx = USER_HEADERS.index("last_login_at") + 1
    _spreadsheet().worksheet(TAB_USERS).update_cell(row_num, col_idx, datetime.now().isoformat())
    _invalidate(f"records:{TAB_USERS}")


def list_users() -> list[dict]:
    return [_normalize_user(r) for r in _records(TAB_USERS)]


def set_user_active(user_id: str, active: bool) -> None:
    row_num = _row_index(TAB_USERS, "id", user_id)
    if row_num is None:
        return
    col_idx = USER_HEADERS.index("is_active") + 1
    _spreadsheet().worksheet(TAB_USERS).update_cell(row_num, col_idx, 1 if active else 0)
    _invalidate(f"records:{TAB_USERS}")


# ---------------------------------------------------------------------------
# POs
# ---------------------------------------------------------------------------

def _normalize_po(r: dict, line_items: list[dict] | None = None) -> dict:
    return {
        "id": r.get("id") or "",
        "po_number": r.get("po_number") or "",
        "po_date": r.get("po_date") or "",
        "revision": r.get("revision") or "",
        "customer": r.get("customer") or "",
        "customer_address": r.get("customer_address") or "",
        "supplier": r.get("supplier") or "",
        "supplier_address": r.get("supplier_address") or "",
        "bill_to": r.get("bill_to") or "",
        "ship_to": r.get("ship_to") or "",
        "payment_terms": r.get("payment_terms") or "",
        "buyer": r.get("buyer") or "",
        "buyer_email": r.get("buyer_email") or "",
        "currency": r.get("currency") or "USD",
        "total": float(r.get("total") or 0),
        "filename": r.get("filename") or "",
        "notes": r.get("notes") or "",
        "status": r.get("status") or "received",
        "has_source": int(r.get("has_source") or 0),
        "extraction_method": r.get("extraction_method") or "text",
        "created_by_id": r.get("created_by_id") or "",
        "created_by_email": r.get("created_by_email") or "",
        "updated_by_id": r.get("updated_by_id") or "",
        "updated_by_email": r.get("updated_by_email") or "",
        "added_at": r.get("added_at") or "",
        "updated_at": r.get("updated_at") or "",
        "line_items": line_items if line_items is not None else _line_items_for(r.get("id") or ""),
    }


def _normalize_line(r: dict) -> dict:
    return {
        "id": r.get("id") or "",
        "po_id": r.get("po_id") or "",
        "line": int(r.get("line") or 0),
        "customer_part": r.get("customer_part") or "",
        "vendor_part": r.get("vendor_part") or "",
        "description": r.get("description") or "",
        "quantity": float(r.get("quantity") or 0),
        "uom": r.get("uom") or "EA",
        "unit_price": float(r.get("unit_price") or 0),
        "amount": float(r.get("amount") or 0),
        "required_date": r.get("required_date") or "",
    }


def _line_items_for(po_id: str) -> list[dict]:
    if not po_id:
        return []
    return [_normalize_line(r) for r in _records(TAB_LINES) if str(r.get("po_id")) == str(po_id)]


def list_pos(query: str = "", period: str = "all", status: str = "all", created_by_id: str | None = None) -> list[dict]:
    rows = _records(TAB_POS)
    lines_by_po: dict[str, list[dict]] = {}
    for r in _records(TAB_LINES):
        lines_by_po.setdefault(str(r.get("po_id")), []).append(_normalize_line(r))

    results = []
    q = (query or "").strip().lower()
    cutoff = None
    if period and period != "all":
        days = {"7d": 7, "30d": 30, "90d": 90}.get(period)
        if days:
            cutoff = (datetime.now() - timedelta(days=days)).isoformat()

    for r in rows:
        po_id = str(r.get("id") or "")
        if status and status != "all" and (r.get("status") or "received") != status:
            continue
        if created_by_id and r.get("created_by_id") != created_by_id:
            continue
        if cutoff and (r.get("added_at") or "") < cutoff:
            continue
        if q:
            lines = lines_by_po.get(po_id, [])
            haystack = " ".join([
                str(r.get("po_number") or ""), str(r.get("customer") or ""),
                str(r.get("supplier") or ""), str(r.get("buyer") or ""),
                *(l.get("description", "") + " " + l.get("vendor_part", "") + " " + l.get("customer_part", "") for l in lines),
            ]).lower()
            if q not in haystack:
                continue
        results.append(_normalize_po(r, lines_by_po.get(po_id, [])))

    results.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
    return results


def get_po(po_id: str) -> dict | None:
    for r in _records(TAB_POS):
        if str(r.get("id")) == str(po_id):
            return _normalize_po(r)
    return None


def find_by_po_number(po_number: str) -> dict | None:
    po_number = (po_number or "").strip()
    if not po_number:
        return None
    matches = [r for r in _records(TAB_POS) if (r.get("po_number") or "").strip() == po_number]
    if not matches:
        return None
    matches.sort(key=lambda x: x.get("added_at") or "", reverse=True)
    return _normalize_po(matches[0])


def create_po(data: dict, *, created_by_id: str | None = None, created_by_email: str | None = None) -> dict:
    po_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    line_items = data.get("line_items") or []

    po_row_data = {
        **data,
        "id": po_id,
        "currency": data.get("currency") or "USD",
        "total": float(data.get("total") or 0),
        "status": data.get("status") or "received",
        "has_source": 0,
        "extraction_method": data.get("extraction_method") or "text",
        "created_by_id": created_by_id or "",
        "created_by_email": created_by_email or "",
        "updated_by_id": created_by_id or "",
        "updated_by_email": created_by_email or "",
        "added_at": now,
        "updated_at": now,
    }

    sh = _spreadsheet()
    sh.worksheet(TAB_POS).append_row(
        _build_row(PO_HEADERS, po_row_data), value_input_option="USER_ENTERED"
    )
    if line_items:
        line_rows = [
            _build_row(LINE_HEADERS, {**it, "id": str(uuid.uuid4()), "po_id": po_id})
            for it in line_items
        ]
        sh.worksheet(TAB_LINES).append_rows(line_rows, value_input_option="USER_ENTERED")

    _invalidate(f"records:{TAB_POS}", f"records:{TAB_LINES}")
    return get_po(po_id)


def update_po(po_id: str, data: dict, *, updated_by_id: str | None = None, updated_by_email: str | None = None) -> dict | None:
    row_num = _row_index(TAB_POS, "id", po_id)
    if row_num is None:
        return None
    now = datetime.now().isoformat()
    line_items = data.get("line_items") or []

    # Preserve added_at/created_by by reading the existing row.
    existing = get_po(po_id)
    if not existing:
        return None

    po_row_data = {
        **existing,
        **data,
        "id": po_id,
        "currency": data.get("currency") or existing.get("currency") or "USD",
        "total": float(data.get("total") or 0),
        "status": data.get("status") or existing.get("status") or "received",
        "updated_by_id": updated_by_id or existing.get("updated_by_id") or "",
        "updated_by_email": updated_by_email or existing.get("updated_by_email") or "",
        "added_at": existing.get("added_at") or now,
        "updated_at": now,
    }
    # Don't let line_items leak into PO row
    po_row_data.pop("line_items", None)

    sh = _spreadsheet()
    sh.worksheet(TAB_POS).update(
        f"A{row_num}",
        [_build_row(PO_HEADERS, po_row_data)],
        value_input_option="USER_ENTERED",
    )

    # Replace line items
    _delete_lines_for_po(po_id)
    if line_items:
        line_rows = [
            _build_row(LINE_HEADERS, {**it, "id": str(uuid.uuid4()), "po_id": po_id})
            for it in line_items
        ]
        sh.worksheet(TAB_LINES).append_rows(line_rows, value_input_option="USER_ENTERED")

    _invalidate(f"records:{TAB_POS}", f"records:{TAB_LINES}")
    return get_po(po_id)


def _delete_lines_for_po(po_id: str) -> None:
    ws = _spreadsheet().worksheet(TAB_LINES)
    rows = _records(TAB_LINES)
    indices = [i + 2 for i, r in enumerate(rows) if str(r.get("po_id")) == str(po_id)]
    for idx in sorted(indices, reverse=True):
        try:
            ws.delete_rows(idx)
        except Exception as e:
            print(f"[db_sheets] Failed to delete line row {idx}: {e}", file=sys.stderr)


def delete_po(po_id: str) -> bool:
    row_num = _row_index(TAB_POS, "id", po_id)
    if row_num is None:
        return False
    _delete_lines_for_po(po_id)
    _spreadsheet().worksheet(TAB_POS).delete_rows(row_num)
    _invalidate(f"records:{TAB_POS}", f"records:{TAB_LINES}")
    return True


def mark_source_stored(po_id: str, has_source: bool = True) -> None:
    row_num = _row_index(TAB_POS, "id", po_id)
    if row_num is None:
        return
    col_idx = PO_HEADERS.index("has_source") + 1
    _spreadsheet().worksheet(TAB_POS).update_cell(row_num, col_idx, 1 if has_source else 0)
    _invalidate(f"records:{TAB_POS}")


def clear_all() -> int:
    sh = _spreadsheet()
    pos_ws = sh.worksheet(TAB_POS)
    lines_ws = sh.worksheet(TAB_LINES)
    count = max(0, len(_records(TAB_POS)))
    if count > 0:
        # Clear data rows but keep header
        pos_ws.batch_clear(["A2:Z10000"])
        lines_ws.batch_clear(["A2:Z10000"])
    _invalidate(f"records:{TAB_POS}", f"records:{TAB_LINES}")
    return count


def stats() -> dict:
    pos = _records(TAB_POS)
    lines = _records(TAB_LINES)
    users = _records(TAB_USERS)
    total_value = sum(float(r.get("total") or 0) for r in pos)
    suppliers = {(r.get("supplier") or "").strip() for r in pos if (r.get("supplier") or "").strip()}
    active_users = sum(1 for u in users if int(u.get("is_active") or 0) == 1)
    return {
        "po_count": len(pos),
        "total_value": total_value,
        "line_count": len(lines),
        "supplier_count": len(suppliers),
        "active_user_count": active_users,
    }


def list_distinct(field: str) -> list[str]:
    """Sorted unique non-empty values for a PO column (for autocomplete)."""
    if field not in {"customer", "supplier", "buyer", "payment_terms"}:
        return []
    vals = {(r.get(field) or "").strip() for r in _records(TAB_POS)}
    return sorted(v for v in vals if v)


# ---------------------------------------------------------------------------
# Compatibility shim — backend.py uses `with db.get_conn() as conn` for the
# distinct-values query. We provide a context manager that exposes an
# `execute()` method emulating just enough sqlite3 semantics for that case.
# ---------------------------------------------------------------------------

class _FakeCursor:
    def __init__(self, rows): self._rows = rows
    def fetchall(self): return self._rows
    def fetchone(self): return self._rows[0] if self._rows else None


class _FakeConn:
    """Read-only emulation of sqlite3 for the small set of raw-SQL paths."""
    def execute(self, sql: str, params: tuple = ()):
        s = sql.strip().lower()
        # SELECT DISTINCT {col} AS v FROM pos WHERE ...
        if s.startswith("select distinct"):
            # Pull the column name between "distinct" and "as v"
            try:
                col = sql.lower().split("distinct", 1)[1].split("as", 1)[0].strip()
            except Exception:
                col = "customer"
            values = list_distinct(col)
            return _FakeCursor([{"v": v} for v in values])
        # SELECT COUNT(*) AS c, SUM(total) AS t FROM pos
        if "from pos" in s and "count(*)" in s:
            s2 = stats()
            return _FakeCursor([{"c": s2["po_count"], "t": s2["total_value"]}])
        if "from line_items" in s and "count(*)" in s:
            return _FakeCursor([{"c": stats()["line_count"]}])
        if "from users" in s and "count(*)" in s:
            return _FakeCursor([{"c": stats()["active_user_count"]}])
        return _FakeCursor([])


@contextmanager
def get_conn():
    """Compat shim — yields a fake cursor object for the few raw-SQL callsites."""
    yield _FakeConn()
