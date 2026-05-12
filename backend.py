"""
backend.py — FastAPI service for Foundry. Auth + SQLite persistence + Excel export.

Run:
    uvicorn backend:app --port 8503 --reload

Auth flow:
    POST /api/auth/register   { email, full_name, password }
    POST /api/auth/login      { email, password }   → { token, user }
    GET  /api/auth/me                                → { id, email, full_name, role }

All /api/pos/* and /api/stats endpoints require Authorization: Bearer <token>.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, HTMLResponse
from pydantic import BaseModel, EmailStr, Field

import db
import excel_export
import auth
import frontend_html

app = FastAPI(title="Foundry API", version="0.4.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

ROOT = Path(__file__).parent
FILES_DIR = ROOT / "files"
FILES_DIR.mkdir(exist_ok=True)


@app.on_event("startup")
def _startup():
    db.init()


# ============================================================================
# Pydantic models
# ============================================================================

class LineItem(BaseModel):
    line: int = 1
    customer_part: str = ""
    vendor_part: str = ""
    description: str = ""
    quantity: float = 0
    uom: str = "EA"
    unit_price: float = 0
    amount: float = 0
    required_date: str = ""


class PORecord(BaseModel):
    po_number: str
    po_date: str = ""
    revision: str = ""
    customer: str = ""
    customer_address: str = ""
    supplier: str = ""
    supplier_address: str = ""
    bill_to: str = ""
    ship_to: str = ""
    payment_terms: str = ""
    buyer: str = ""
    buyer_email: str = ""
    currency: str = "USD"
    total: float = 0
    filename: str = ""
    notes: str = ""
    status: str = "received"
    extraction_method: str = "text"
    line_items: list[LineItem] = Field(default_factory=list)


class PORecordSaved(PORecord):
    id: str
    added_at: str
    updated_at: str
    has_source: int = 0
    created_by_id: Optional[str] = None
    created_by_email: Optional[str] = None
    updated_by_id: Optional[str] = None
    updated_by_email: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    token: str
    user: auth.CurrentUser


class ProfileUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=120)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=200)


class AdminCreateUser(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=120)
    role: str = Field(pattern="^(admin|rep)$")
    # If omitted, the server generates a random temp password and returns
    # it once in the response (admin shares it with the user out-of-band).
    password: Optional[str] = Field(default=None, min_length=8, max_length=200)


# ============================================================================
# Public endpoints
# ============================================================================

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "foundry-backend",
        "version": "0.4.0",
    }


# ---------------------------------------------------------------------------
# Single-page-app HTML — served at "/" in production (HF Spaces).
# In Streamlit dev mode, Streamlit serves the HTML inside a components.html
# iframe instead and this endpoint is unused.
# ---------------------------------------------------------------------------
def _effective_llm_api_key() -> tuple[str, str]:
    """Resolve the LLM API key the frontend should use.

    Order of preference:
        1. Admin-set DB value (rotatable from the in-app Admin card)
        2. OPENROUTER_API_KEY env var (HF Space secret)
        3. GEMINI_API_KEY env var
        4. empty string (LLM features disabled)

    Returns (key, source) where source is one of: "db" | "env" | "none".
    """
    db_key = db.get_config("llm_api_key")
    if db_key:
        return db_key, "db"
    env_key = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("GEMINI_API_KEY") or ""
    if env_key:
        return env_key, "env"
    return "", "none"


@app.get("/", response_class=HTMLResponse)
def index():
    key, _source = _effective_llm_api_key()
    return frontend_html.build_app_html(api_key=key)


# ============================================================================
# Auth endpoints
#
# Self-registration is intentionally NOT exposed — accounts are created by
# admins via POST /api/team/users (see below). For an internal tool with a
# fixed roster, that's both simpler and safer than an invitation flow.
# ============================================================================

@app.post("/api/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest):
    user = auth.authenticate(payload.email, payload.password)
    if not user:
        raise HTTPException(401, "Invalid email or password.")
    token = auth.create_access_token(user["id"], user["email"], user["role"])
    return {"token": token, "user": auth.CurrentUser(**user)}


@app.get("/api/auth/me", response_model=auth.CurrentUser)
def me(user: auth.CurrentUser = Depends(auth.current_user)):
    return user


@app.put("/api/auth/me", response_model=auth.CurrentUser)
def update_me(payload: ProfileUpdate, user: auth.CurrentUser = Depends(auth.current_user)):
    updated = auth.update_profile(user.id, full_name=payload.full_name)
    if not updated:
        raise HTTPException(404, "User not found.")
    return auth.CurrentUser(**updated)


@app.post("/api/auth/password")
def change_password(payload: PasswordChange, user: auth.CurrentUser = Depends(auth.current_user)):
    ok = auth.change_password(user.id, payload.current_password, payload.new_password)
    if not ok:
        raise HTTPException(400, "Current password is incorrect.")
    return {"updated": True}


@app.post("/api/auth/logout")
def logout(user: auth.CurrentUser = Depends(auth.current_user)):
    # JWT is stateless — client just discards the token. Endpoint exists for
    # symmetry / future blacklist support.
    return {"ok": True}


# ============================================================================
# Stats + PO endpoints (all require auth)
# ============================================================================

@app.get("/api/stats")
def stats(user: auth.CurrentUser = Depends(auth.current_user)):
    return db.stats()


@app.get("/api/pos", response_model=list[PORecordSaved])
def list_pos(
    query: str = Query(""),
    period: str = Query("all"),
    status_: str = Query("all", alias="status"),
    user: auth.CurrentUser = Depends(auth.current_user),
):
    return db.list_pos(query=query, period=period, status=status_)


@app.get("/api/pos/export.xlsx")
def export_xlsx(user: auth.CurrentUser = Depends(auth.current_user)):
    records = db.list_pos()
    buf = excel_export.build_workbook(records)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="po_ledger.xlsx"'},
    )


@app.get("/api/pos/by-number/{po_number}", response_model=Optional[PORecordSaved])
def find_by_number(po_number: str, user: auth.CurrentUser = Depends(auth.current_user)):
    return db.find_by_po_number(po_number)


@app.get("/api/pos/{po_id}", response_model=PORecordSaved)
def get_po(po_id: str, user: auth.CurrentUser = Depends(auth.current_user)):
    rec = db.get_po(po_id)
    if not rec:
        raise HTTPException(404, f"PO {po_id} not found")
    return rec


@app.post("/api/pos", response_model=PORecordSaved, status_code=201)
def create_po(po: PORecord, user: auth.CurrentUser = Depends(auth.current_user)):
    return db.create_po(po.model_dump(), created_by_id=user.id, created_by_email=user.email)


@app.put("/api/pos/{po_id}", response_model=PORecordSaved)
def update_po(po_id: str, po: PORecord, user: auth.CurrentUser = Depends(auth.current_user)):
    updated = db.update_po(po_id, po.model_dump(), updated_by_id=user.id, updated_by_email=user.email)
    if not updated:
        raise HTTPException(404, f"PO {po_id} not found")
    return updated


@app.delete("/api/pos/{po_id}")
def delete_po(po_id: str, user: auth.CurrentUser = Depends(auth.current_user)):
    if not db.delete_po(po_id):
        raise HTTPException(404, f"PO {po_id} not found")
    for ext in ("pdf", "docx", "doc", "png", "jpg", "jpeg", "tiff", "bmp"):
        p = FILES_DIR / f"{po_id}.{ext}"
        if p.exists():
            try: p.unlink()
            except OSError: pass
    return {"deleted": po_id}


@app.patch("/api/pos/{po_id}/status")
def update_status(po_id: str, payload: dict, user: auth.CurrentUser = Depends(auth.current_user)):
    """Quick status-only update — no need to send the full PO body."""
    new_status = (payload or {}).get("status")
    valid = {"received", "acknowledged", "in_progress", "shipped", "invoiced", "closed"}
    if new_status not in valid:
        raise HTTPException(400, f"Invalid status. Must be one of: {', '.join(sorted(valid))}")
    rec = db.get_po(po_id)
    if not rec:
        raise HTTPException(404, f"PO {po_id} not found")
    rec["status"] = new_status
    return db.update_po(po_id, rec, updated_by_id=user.id, updated_by_email=user.email)


class BulkAction(BaseModel):
    ids: list[str]


@app.post("/api/pos/bulk/delete")
def bulk_delete(payload: BulkAction, user: auth.CurrentUser = Depends(auth.current_user)):
    deleted = 0
    for pid in payload.ids:
        if db.delete_po(pid):
            deleted += 1
            for ext in ("pdf", "docx", "doc", "png", "jpg", "jpeg", "tiff", "bmp"):
                p = FILES_DIR / f"{pid}.{ext}"
                if p.exists():
                    try: p.unlink()
                    except OSError: pass
    return {"deleted": deleted, "requested": len(payload.ids)}


class BulkStatus(BaseModel):
    ids: list[str]
    status: str


@app.post("/api/pos/bulk/status")
def bulk_status(payload: BulkStatus, user: auth.CurrentUser = Depends(auth.current_user)):
    valid = {"received", "acknowledged", "in_progress", "shipped", "invoiced", "closed"}
    if payload.status not in valid:
        raise HTTPException(400, f"Invalid status. Must be one of: {', '.join(sorted(valid))}")
    updated = 0
    for pid in payload.ids:
        rec = db.get_po(pid)
        if not rec: continue
        rec["status"] = payload.status
        if db.update_po(pid, rec, updated_by_id=user.id, updated_by_email=user.email):
            updated += 1
    return {"updated": updated, "status": payload.status}


@app.get("/api/distinct/{field}")
def distinct_values(field: str, user: auth.CurrentUser = Depends(auth.current_user)):
    """Return sorted unique values for a column — used by frontend autocomplete."""
    allowed = {"customer", "supplier", "buyer", "payment_terms"}
    if field not in allowed:
        raise HTTPException(400, f"Unsupported field. Allowed: {', '.join(sorted(allowed))}")
    return {"field": field, "values": db.list_distinct(field)}


@app.get("/api/team")
def list_team(user: auth.CurrentUser = Depends(auth.require_admin)):
    """Admin only — list all registered users."""
    return {"users": db.list_users()}


class TeamMemberToggle(BaseModel):
    user_id: str
    is_active: bool


@app.post("/api/team/active")
def set_active(payload: TeamMemberToggle, user: auth.CurrentUser = Depends(auth.require_admin)):
    if payload.user_id == user.id and not payload.is_active:
        raise HTTPException(400, "You can't deactivate yourself.")
    db.set_user_active(payload.user_id, payload.is_active)
    return {"ok": True}


@app.post("/api/team/users", status_code=201)
def admin_create_user(
    payload: AdminCreateUser,
    user: auth.CurrentUser = Depends(auth.require_admin),
):
    """Admin creates a new account directly. If the admin doesn't supply a
    password, we generate a temp one and return it ONCE so the admin can
    pass it on to the user out-of-band. The user changes it later via the
    Profile screen."""
    email = payload.email.lower().strip()
    if db.find_user_by_email(email):
        raise HTTPException(409, "An account with this email already exists.")
    generated = payload.password is None
    password = payload.password or auth.generate_temp_password()
    new_user = auth.create_user(
        email=email,
        full_name=payload.full_name.strip(),
        password=password,
        role=payload.role,
    )
    return {
        "user": new_user,
        # Only echo the password when WE generated it (admin won't have it
        # otherwise). If the admin supplied one, they already know it.
        "temporary_password": password if generated else None,
    }


# ============================================================================
# Admin: app-wide config (LLM key rotation + system status)
# ============================================================================

def _mask_secret(s: str) -> str:
    if not s:
        return ""
    if len(s) <= 8:
        return "•" * len(s)
    return f"{s[:4]}{'•' * 6}{s[-4:]}"


def _config_snapshot() -> dict:
    key, source = _effective_llm_api_key()
    stats = db.stats()
    return {
        "llm_api_key_set": bool(key),
        "llm_api_key_source": source,          # "db" | "env" | "none"
        "llm_api_key_masked": _mask_secret(key),
        "stats": stats,
    }


class AdminConfigUpdate(BaseModel):
    # Set llm_api_key to a string to store an admin override; pass an empty
    # string or null and the DELETE endpoint clears it instead.
    llm_api_key: Optional[str] = Field(default=None, max_length=400)


@app.get("/api/admin/config")
def get_admin_config(user: auth.CurrentUser = Depends(auth.require_admin)):
    return _config_snapshot()


@app.put("/api/admin/config")
def set_admin_config(
    payload: AdminConfigUpdate,
    user: auth.CurrentUser = Depends(auth.require_admin),
):
    if payload.llm_api_key is not None:
        val = payload.llm_api_key.strip()
        if val:
            db.set_config("llm_api_key", val, user.id)
        else:
            db.delete_config("llm_api_key")
    return _config_snapshot()


@app.delete("/api/admin/config/llm-api-key")
def clear_admin_llm_key(user: auth.CurrentUser = Depends(auth.require_admin)):
    """Drop the DB-stored LLM key and fall back to the Space-secret env var."""
    db.delete_config("llm_api_key")
    return _config_snapshot()


@app.post("/api/team/users/{user_id}/reset-password")
def admin_reset_password(
    user_id: str,
    user: auth.CurrentUser = Depends(auth.require_admin),
):
    """Admin generates a fresh temp password for an existing user. Returned
    once. User should change it on their next login via Profile."""
    target = db.get_user(user_id)
    if not target:
        raise HTTPException(404, "User not found.")
    new_password = auth.generate_temp_password()
    auth.admin_set_password(user_id, new_password)
    return {"user_id": user_id, "temporary_password": new_password}


@app.delete("/api/pos")
def clear_all(user: auth.CurrentUser = Depends(auth.require_admin)):
    n = db.clear_all()
    for f in FILES_DIR.iterdir():
        if f.is_file():
            try: f.unlink()
            except OSError: pass
    return {"deleted_count": n}


@app.post("/api/pos/{po_id}/source")
async def upload_source(po_id: str, file: UploadFile = File(...),
                        user: auth.CurrentUser = Depends(auth.current_user)):
    rec = db.get_po(po_id)
    if not rec:
        raise HTTPException(404, f"PO {po_id} not found")
    suffix = Path(file.filename or "").suffix.lower().lstrip(".") or "pdf"
    if suffix not in {"pdf", "docx", "doc", "png", "jpg", "jpeg", "tiff", "bmp"}:
        raise HTTPException(400, f"Unsupported file type: .{suffix}")
    target = FILES_DIR / f"{po_id}.{suffix}"
    contents = await file.read()
    target.write_bytes(contents)
    db.mark_source_stored(po_id, True)
    return {"po_id": po_id, "stored": str(target.name), "bytes": len(contents)}


@app.post("/api/extract/parse")
async def extract_parse(
    file: UploadFile = File(...),
    user: auth.CurrentUser = Depends(auth.current_user),
):
    """Parse a PDF with pdfplumber and return layout-aware text.

    The frontend uses this for the text-extraction path on long PDFs (>5
    pages). For short PDFs the frontend renders pages to images client-side
    and goes straight to the vision LLM — skipping this endpoint entirely.

    Returns:
        {
            "page_count": int,
            "text": "--- Page 1 ---\\n...\\n\\n--- Page 2 ---\\n...",
        }

    The text comes from pdfplumber's extract_text(layout=True) which
    preserves column whitespace. A "last-wins" character dedup pass
    removes overlaid template placeholders that we've seen on some
    Ariba-generated POs (DEF Purchasing Co. drawn under APG Purchasing
    Co., SEFCOR INC drawn under ALLIED COMPONENTS INC, etc.).
    """
    import io
    try:
        import pdfplumber
    except ImportError:
        raise HTTPException(500, "pdfplumber not installed on the server.")

    contents = await file.read()
    if not contents:
        raise HTTPException(400, "Empty upload.")

    try:
        pdf = pdfplumber.open(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(400, f"Couldn't read PDF: {e}")

    try:
        pages_text: list[str] = []
        for page in pdf.pages:
            # Last-wins dedup: in a 2-pt grid cell, keep only the LAST char
            # drawn at that position. Visually, the later draw is on top,
            # which is what a human reading the PDF actually sees.
            chars = page.chars
            keep_indices: dict[tuple[int, int], int] = {}
            for idx, c in enumerate(chars):
                key = (int(c["x0"] / 2), int(c["top"] / 2))
                if key not in keep_indices or idx > keep_indices[key]:
                    keep_indices[key] = idx
            keepers = {id(chars[i]) for i in keep_indices.values()}
            filtered = page.filter(lambda c, kp=keepers: id(c) in kp)
            pages_text.append(filtered.extract_text(layout=True) or "")

        full = "\n\n".join(
            f"--- Page {i + 1} ---\n{t}" for i, t in enumerate(pages_text)
        )
        return {
            "page_count": len(pages_text),
            "pages": pages_text,   # per-page text, useful for client-side chunking
            "text": full,           # convenience: pre-joined with separators
        }
    finally:
        pdf.close()


@app.get("/api/pos/{po_id}/source")
def get_source(po_id: str):
    """Public so PdfPreview iframe can load without sending Authorization
    header (browsers can't add headers to iframe src). The URL contains a
    UUID which is unguessable — sufficient for an internal tool."""
    rec = db.get_po(po_id)
    if not rec:
        raise HTTPException(404, f"PO {po_id} not found")
    for ext in ("pdf", "docx", "doc", "png", "jpg", "jpeg", "tiff", "bmp"):
        p = FILES_DIR / f"{po_id}.{ext}"
        if p.exists():
            mt = {
                "pdf": "application/pdf",
                "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "doc": "application/msword",
                "png": "image/png",
                "jpg": "image/jpeg",
                "jpeg": "image/jpeg",
                "tiff": "image/tiff",
                "bmp": "image/bmp",
            }.get(ext, "application/octet-stream")
            return FileResponse(
                str(p),
                media_type=mt,
                headers={"Content-Disposition": f'inline; filename="{rec.get("filename", p.name)}"'},
            )
    raise HTTPException(404, f"No source file stored for {po_id}")
