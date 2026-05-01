"""
excel_export.py — Build a two-sheet XLSX workbook from a list of PO records.

Used by the FastAPI `/api/pos/export.xlsx` endpoint to generate the rolling
Excel ledger from the SQLite database.
"""
from __future__ import annotations

import io
from typing import Iterable

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

HEADER_FONT = Font(bold=True, color="FFFFFF", size=11)
HEADER_FILL = PatternFill("solid", fgColor="4F46E5")
HEADER_ALIGN = Alignment(horizontal="left", vertical="center", indent=1)


def _style_header_row(ws, columns: list[tuple[str, int]]):
    for idx, (label, width) in enumerate(columns, 1):
        cell = ws.cell(row=1, column=idx, value=label)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = HEADER_ALIGN
        ws.column_dimensions[get_column_letter(idx)].width = width
    ws.row_dimensions[1].height = 22
    ws.freeze_panes = "A2"


def _flatten(s) -> str:
    if not s:
        return ""
    return str(s).replace("\n", " · ").strip()


def build_workbook(records: Iterable[dict]) -> io.BytesIO:
    """Return a BytesIO with a fresh XLSX containing two sheets."""
    records = list(records)

    wb = Workbook()

    # ---------- Sheet 1: Purchase Orders ----------
    ws1 = wb.active
    ws1.title = "Purchase Orders"

    columns_po = [
        ("PO Number", 16),
        ("PO Date", 12),
        ("Revision", 8),
        ("Customer", 28),
        ("Supplier", 28),
        ("Bill To", 36),
        ("Ship To", 36),
        ("Payment Terms", 14),
        ("Buyer", 18),
        ("Buyer Email", 26),
        ("Line Items", 11),
        ("Total", 14),
        ("Currency", 8),
        ("Source File", 28),
        ("Notes", 24),
        ("Added", 18),
        ("Updated", 18),
    ]
    _style_header_row(ws1, columns_po)

    for r_idx, rec in enumerate(records, 2):
        ws1.cell(row=r_idx, column=1, value=rec.get("po_number", ""))
        ws1.cell(row=r_idx, column=2, value=rec.get("po_date", ""))
        ws1.cell(row=r_idx, column=3, value=rec.get("revision", ""))
        ws1.cell(row=r_idx, column=4, value=rec.get("customer", ""))
        ws1.cell(row=r_idx, column=5, value=rec.get("supplier", ""))
        ws1.cell(row=r_idx, column=6, value=_flatten(rec.get("bill_to")))
        ws1.cell(row=r_idx, column=7, value=_flatten(rec.get("ship_to")))
        ws1.cell(row=r_idx, column=8, value=rec.get("payment_terms", ""))
        ws1.cell(row=r_idx, column=9, value=rec.get("buyer", ""))
        ws1.cell(row=r_idx, column=10, value=rec.get("buyer_email", ""))
        ws1.cell(row=r_idx, column=11, value=len(rec.get("line_items") or []))
        total_cell = ws1.cell(row=r_idx, column=12, value=float(rec.get("total") or 0))
        total_cell.number_format = '"$"#,##0.00'
        ws1.cell(row=r_idx, column=13, value=rec.get("currency", "USD"))
        ws1.cell(row=r_idx, column=14, value=rec.get("filename", ""))
        ws1.cell(row=r_idx, column=15, value=rec.get("notes", ""))
        ws1.cell(row=r_idx, column=16, value=rec.get("added_at", ""))
        ws1.cell(row=r_idx, column=17, value=rec.get("updated_at", ""))

    # ---------- Sheet 2: Line Items ----------
    ws2 = wb.create_sheet("Line Items")

    columns_lines = [
        ("PO Number", 16),
        ("Customer", 24),
        ("Supplier", 24),
        ("Line", 6),
        ("Customer Part", 16),
        ("Vendor Part", 20),
        ("Description", 44),
        ("Quantity", 9),
        ("UOM", 6),
        ("Unit Price", 13),
        ("Amount", 14),
        ("Required Date", 14),
    ]
    _style_header_row(ws2, columns_lines)

    r_idx = 2
    for rec in records:
        for it in rec.get("line_items") or []:
            ws2.cell(row=r_idx, column=1, value=rec.get("po_number", ""))
            ws2.cell(row=r_idx, column=2, value=rec.get("customer", ""))
            ws2.cell(row=r_idx, column=3, value=rec.get("supplier", ""))
            ws2.cell(row=r_idx, column=4, value=int(it.get("line") or 0))
            ws2.cell(row=r_idx, column=5, value=it.get("customer_part", ""))
            ws2.cell(row=r_idx, column=6, value=it.get("vendor_part", ""))
            ws2.cell(row=r_idx, column=7, value=it.get("description", ""))
            ws2.cell(row=r_idx, column=8, value=float(it.get("quantity") or 0))
            ws2.cell(row=r_idx, column=9, value=it.get("uom", ""))
            unit_cell = ws2.cell(row=r_idx, column=10, value=float(it.get("unit_price") or 0))
            unit_cell.number_format = '"$"#,##0.00'
            amt_cell = ws2.cell(row=r_idx, column=11, value=float(it.get("amount") or 0))
            amt_cell.number_format = '"$"#,##0.00'
            ws2.cell(row=r_idx, column=12, value=it.get("required_date", ""))
            r_idx += 1

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf
