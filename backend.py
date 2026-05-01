"""
backend.py — FastAPI service for Foundry. Persists POs in SQLite, stores
source PDFs on disk, and exports the ledger as XLSX.

Run:
    uvicorn backend:app --port 8503 --reload

Endpoints:
    GET    /api/health                        Health check
    GET    /api/stats                         Aggregate counts/totals
    GET    /api/pos                           List all POs (?query=&period=)
    GET    /api/pos/export.xlsx               Download Excel of the entire ledger
    GET    /api/pos/by-number/{po_number}     Lookup by PO# (duplicate detection)
    GET    /api/pos/{id}                      Get one PO + line items
    POST   /api/pos                           Create a new PO
    PUT    /api/pos/{id}                      Update an existing PO
    DELETE /api/pos/{id}                      Delete a PO (cascade to line items + source)
    DELETE /api/pos                           Delete ALL POs (clear ledger)
    POST   /api/pos/{id}/source               Upload the original PDF/file for a PO
    GET    /api/pos/{id}/source               Stream the original file (inline display)
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, Response
from pydantic import BaseModel, Field

import db
import excel_export

app = FastAPI(title="Foundry API", version="0.3.0")

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


# -------- Pydantic models --------

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
    extraction_method: str = "text"
    line_items: list[LineItem] = Field(default_factory=list)


class PORecordSaved(PORecord):
    id: str
    added_at: str
    updated_at: str
    has_source: int = 0


# -------- Endpoints --------

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "foundry-backend", "version": "0.3.0"}


@app.get("/api/stats")
def stats():
    return db.stats()


@app.get("/api/pos", response_model=list[PORecordSaved])
def list_pos(
    query: str = Query("", description="Free-text search across PO#, customer, supplier, line item descriptions/parts"),
    period: str = Query("all", description="Filter window: all | 7d | 30d | 90d"),
):
    return db.list_pos(query=query, period=period)


# IMPORTANT: literal-segment routes (export.xlsx, by-number/...) must be
# declared BEFORE the {po_id} routes, otherwise FastAPI captures the literal
# segment as a path parameter and 404s.
@app.get("/api/pos/export.xlsx")
def export_xlsx():
    records = db.list_pos()
    buf = excel_export.build_workbook(records)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="po_ledger.xlsx"'},
    )


@app.get("/api/pos/by-number/{po_number}", response_model=Optional[PORecordSaved])
def find_by_number(po_number: str):
    return db.find_by_po_number(po_number)


@app.get("/api/pos/{po_id}", response_model=PORecordSaved)
def get_po(po_id: str):
    rec = db.get_po(po_id)
    if not rec:
        raise HTTPException(404, f"PO {po_id} not found")
    return rec


@app.post("/api/pos", response_model=PORecordSaved, status_code=201)
def create_po(po: PORecord):
    return db.create_po(po.model_dump())


@app.put("/api/pos/{po_id}", response_model=PORecordSaved)
def update_po(po_id: str, po: PORecord):
    updated = db.update_po(po_id, po.model_dump())
    if not updated:
        raise HTTPException(404, f"PO {po_id} not found")
    return updated


@app.delete("/api/pos/{po_id}")
def delete_po(po_id: str):
    if not db.delete_po(po_id):
        raise HTTPException(404, f"PO {po_id} not found")
    # Best-effort cleanup of source file
    for ext in ("pdf", "docx", "doc", "png", "jpg", "jpeg", "tiff", "bmp"):
        p = FILES_DIR / f"{po_id}.{ext}"
        if p.exists():
            try: p.unlink()
            except OSError: pass
    return {"deleted": po_id}


@app.delete("/api/pos")
def clear_all():
    n = db.clear_all()
    # Wipe the files dir
    for f in FILES_DIR.iterdir():
        if f.is_file():
            try: f.unlink()
            except OSError: pass
    return {"deleted_count": n}


@app.post("/api/pos/{po_id}/source")
async def upload_source(po_id: str, file: UploadFile = File(...)):
    """Store the original PDF/file for a PO so it can be previewed later."""
    rec = db.get_po(po_id)
    if not rec:
        raise HTTPException(404, f"PO {po_id} not found")

    # Determine extension from upload filename
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
    """Stream the stored source file with inline disposition (so browser views it)."""
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
