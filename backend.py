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

from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel, EmailStr, Field

import db
import excel_export
import auth

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


class RegisterRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=200)


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


# ============================================================================
# Public endpoints
# ============================================================================

@app.get("/api/health")
def health():
    cfg = auth.load_yaml_config()
    return {
        "status": "ok",
        "service": "foundry-backend",
        "version": "0.4.0",
        "require_invitation": bool(cfg.get("require_invitation", True)),
    }


# ============================================================================
# Auth endpoints
# ============================================================================

@app.post("/api/auth/register", response_model=AuthResponse, status_code=201)
def register(payload: RegisterRequest):
    email = payload.email.lower().strip()

    # Already registered?
    if db.find_user_by_email(email):
        raise HTTPException(409, "An account with this email already exists. Try signing in instead.")

    # Invitation gate
    allowed, invitation = auth.is_invited(email)
    if not allowed:
        raise HTTPException(403, "This email isn't on the invitation list. Contact your admin to be invited.")

    role = (invitation or {}).get("role") or auth.load_yaml_config().get("default_role", "rep")
    name = payload.full_name.strip() or (invitation or {}).get("name") or email.split("@")[0]

    user = auth.create_user(email=email, full_name=name, password=payload.password, role=role)
    token = auth.create_access_token(user["id"], user["email"], user["role"])
    return {"token": token, "user": auth.CurrentUser(**user)}


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
    with db.get_conn() as conn:
        rows = conn.execute(
            f"SELECT DISTINCT {field} AS v FROM pos WHERE {field} IS NOT NULL AND {field} <> '' ORDER BY {field}"
        ).fetchall()
        return {"field": field, "values": [r["v"] for r in rows]}


@app.get("/api/team")
def list_team(user: auth.CurrentUser = Depends(auth.require_admin)):
    """Admin only — list all registered users + invitation roster."""
    users = db.list_users()
    cfg = auth.load_yaml_config()
    invited = cfg.get("invited") or []
    invited_emails = {(i.get("email") or "").strip().lower() for i in invited}
    registered_emails = {u["email"].lower() for u in users}
    pending = [
        {"email": (i.get("email") or "").strip().lower(),
         "name": i.get("name") or "",
         "role": i.get("role") or "rep"}
        for i in invited
        if (i.get("email") or "").strip().lower() not in registered_emails
    ]
    return {
        "users": users,
        "invited_emails": sorted(invited_emails),
        "pending_invitations": pending,
        "require_invitation": bool(cfg.get("require_invitation", True)),
    }


class TeamMemberToggle(BaseModel):
    user_id: str
    is_active: bool


@app.post("/api/team/active")
def set_active(payload: TeamMemberToggle, user: auth.CurrentUser = Depends(auth.require_admin)):
    if payload.user_id == user.id and not payload.is_active:
        raise HTTPException(400, "You can't deactivate yourself.")
    db.set_user_active(payload.user_id, payload.is_active)
    return {"ok": True}


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
