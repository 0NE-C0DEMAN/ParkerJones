"""compare_models.py — Side-by-side LLM extraction benchmark.

Runs the SAME prompt + the SAME PDF through two different models on the
Gemini API (gemini-2.5-flash vs gemma-3-27b-it by default) and prints a
field-by-field diff. Use this to decide whether Gemma is worth adding to
the production model picker.

Usage:
    # one-time setup
    set GEMINI_API_KEY=AIza...    # PowerShell: $env:GEMINI_API_KEY="AIza..."
    pip install requests          # pdfplumber + Pillow already in requirements.txt

    # run against any sample
    python tools/compare_models.py samples/TEMA*.pdf samples/CEEUS*.pdf

    # or pick two specific models
    python tools/compare_models.py --model-a gemini-2.5-flash \
                                   --model-b gemma-3-27b-it    \
                                   samples/TEMA*.pdf

Output: a per-PO table of (field, model-A value, model-B value, agree?)
plus a summary score. Works against the same prompt the production
extractor uses (kept in sync with frontend/src/lib/gemini.js).
"""
from __future__ import annotations

import argparse
import base64
import glob
import io
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path


# ---------------------------------------------------------------------------
# Production-equivalent extraction prompt.
# Mirrors frontend/src/lib/gemini.js → SYSTEM_PROMPT (Description-as-single-
# field variant, after the Phase-1 refactor). If you change one, change
# both — this script's whole point is to compare like-for-like.
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """You are a precise data extraction tool for purchase orders (POs).
Extract structured data into ONE JSON object that strictly matches the schema. No markdown fences, no commentary.

LINE ITEMS — DESCRIPTION IS THE ONLY FIELD FOR PARTS + PRODUCT TEXT
The "description" field is the SINGLE source of truth for every line.
Put EVERY part identifier, model number, catalog code, AND the actual
product description into THIS ONE field, in document order. Always return
customer_part="" and vendor_part="" — those fields are deprecated.

QUANTITY, UNIT_PRICE, AMOUNT are CRITICAL. If you see two of three, compute
the third (quantity × unit_price = amount within ±$0.50). Never return 0
on a line that clearly shows a non-zero value.

OUTPUT SCHEMA
{
  "po_number": "string",
  "po_date": "YYYY-MM-DD",
  "customer": "string",
  "supplier": "string",
  "ship_to": "string (multi-line ok)",
  "bill_to": "string (multi-line ok)",
  "buyer": "string",
  "buyer_email": "string",
  "payment_terms": "string",
  "freight_terms": "string",
  "ship_via": "string",
  "fob_terms": "string",
  "currency": "USD",
  "line_items": [
    {
      "line": 1,
      "customer_part": "",
      "vendor_part": "",
      "description": "string",
      "quantity": 0,
      "uom": "EA",
      "unit_price": 0,
      "amount": 0,
      "required_date": "YYYY-MM-DD",
      "notes": "string"
    }
  ],
  "total": 0,
  "notes": "string (multi-line ok)"
}"""

GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
)


# ---------------------------------------------------------------------------
# PDF → page images. Reuses pdfplumber+Pillow which Foundry already ships.
# ---------------------------------------------------------------------------
def render_pdf_pages(pdf_path: Path, max_pages: int = 3, dpi: int = 144) -> list[tuple[str, str]]:
    """Return [(mime_type, base64_data), ...] for up to `max_pages` pages."""
    try:
        import pdfplumber  # noqa: F401
        from pdf2image import convert_from_path  # type: ignore
    except ImportError:
        # Fall back to PyMuPDF if available, otherwise tell the user.
        try:
            import fitz  # PyMuPDF
        except ImportError:
            print("ERROR: install one of `pdf2image` (+ poppler) or `pymupdf` to render pages.")
            sys.exit(1)
        doc = fitz.open(pdf_path)
        out = []
        for i in range(min(len(doc), max_pages)):
            pix = doc[i].get_pixmap(dpi=dpi)
            out.append(("image/png", base64.b64encode(pix.tobytes("png")).decode()))
        return out

    images = convert_from_path(str(pdf_path), dpi=dpi, last_page=max_pages)
    out = []
    for img in images:
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        out.append(("image/png", base64.b64encode(buf.getvalue()).decode()))
    return out


def extract_pdf_text(pdf_path: Path, max_pages: int = 3) -> str:
    import pdfplumber
    with pdfplumber.open(pdf_path) as pdf:
        pages = pdf.pages[:max_pages]
        return "\n\n".join((p.extract_text() or "") for p in pages)


# ---------------------------------------------------------------------------
# LLM call — same shape gemini.js sends, but works for Gemma too by
# conditionally dropping the Gemini-only generationConfig fields.
# ---------------------------------------------------------------------------
def call_llm(model: str, api_key: str, pdf_path: Path) -> tuple[dict, float]:
    """Returns (extracted_json, seconds_elapsed)."""
    text = extract_pdf_text(pdf_path)
    images = render_pdf_pages(pdf_path)

    parts = [{
        "text":
            "You are given BOTH the parsed text of this PO AND the rendered page images. "
            "Use the text for clean character values. Use the images for spatial layout.\n\n"
            "=== PARSED TEXT ===\n\n" + text +
            "\n\n=== PAGE IMAGES ===",
    }]
    for mime, b64 in images:
        parts.append({"inlineData": {"mimeType": mime, "data": b64}})

    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": 8192,
        },
    }
    # Gemini supports strict-JSON mode + a "thinking" knob. Gemma rejects both.
    if model.startswith("gemini-"):
        body["generationConfig"]["responseMimeType"] = "application/json"
        if "2.5" in model:
            body["generationConfig"]["thinkingConfig"] = {"thinkingBudget": 0}

    url = GEMINI_URL.format(model=model, key=api_key)
    started = time.monotonic()
    last_err = None
    # Retry transient 5xx / 429s with backoff — Gemini Flash 503s under load.
    for attempt in range(4):
        req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST")
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = json.loads(resp.read())
                break
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "ignore")
            last_err = f"HTTP {e.code}: {msg[:200]}"
            if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(2 * (attempt + 1))
                continue
            raise RuntimeError(f"{model}: {last_err}") from None
    else:
        raise RuntimeError(f"{model}: exhausted retries — {last_err}")
    elapsed = time.monotonic() - started

    cand = (payload.get("candidates") or [{}])[0]
    text = "".join(p.get("text", "") for p in (cand.get("content") or {}).get("parts", []))
    # Strip code fences Gemma sometimes adds even when we asked for JSON.
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.MULTILINE)
    try:
        return json.loads(text), elapsed
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            return json.loads(match.group(0)), elapsed
        raise RuntimeError(f"{model}: response not JSON: {text[:200]}")


# ---------------------------------------------------------------------------
# Diff helpers — flatten the extraction into comparable scalars.
# ---------------------------------------------------------------------------
HEADER_FIELDS = [
    "po_number", "po_date", "customer", "supplier",
    "buyer", "buyer_email", "payment_terms", "freight_terms",
    "ship_via", "fob_terms", "currency", "total",
]


def short(v):
    if v is None: return ""
    s = str(v).replace("\n", " ⏎ ").strip()
    return s if len(s) <= 60 else s[:57] + "…"


def flatten(rec: dict) -> dict:
    flat = {f: rec.get(f, "") for f in HEADER_FIELDS}
    flat["line_count"] = len(rec.get("line_items") or [])
    flat["lines_total"] = round(
        sum(float(li.get("amount") or 0) for li in (rec.get("line_items") or [])), 2
    )
    return flat


def compare_extractions(a: dict, b: dict) -> dict:
    """Returns a dict of {field: (a_val, b_val, agree)}."""
    fa = flatten(a)
    fb = flatten(b)
    rows = {}
    for k in fa:
        va, vb = fa[k], fb[k]
        # Numeric tolerance for total / lines_total
        if k in ("total", "lines_total"):
            try:
                agree = abs(float(va or 0) - float(vb or 0)) < 0.51
            except Exception:
                agree = va == vb
        else:
            agree = (str(va).strip().lower() == str(vb).strip().lower())
        rows[k] = (va, vb, agree)
    return rows


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pdfs", nargs="+", help="PDFs to test (globs allowed).")
    parser.add_argument("--model-a", default="gemini-2.5-flash")
    parser.add_argument("--model-b", default="gemma-3-27b-it")
    parser.add_argument("--key", default=os.environ.get("GEMINI_API_KEY") or os.environ.get("OPENROUTER_API_KEY"))
    args = parser.parse_args()

    if not args.key:
        print("ERROR: set GEMINI_API_KEY env var or pass --key.")
        sys.exit(1)

    # Expand globs
    paths = []
    for p in args.pdfs:
        matched = glob.glob(p)
        paths.extend(Path(m) for m in (matched or [p]))

    overall = []
    for pdf in paths:
        if not pdf.exists():
            print(f"[skip] {pdf} not found")
            continue

        print(f"\n{'='*80}\n  {pdf.name}\n{'='*80}")
        try:
            a_rec, a_dt = call_llm(args.model_a, args.key, pdf)
        except Exception as e:
            print(f"  {args.model_a} FAILED: {e}")
            continue
        try:
            b_rec, b_dt = call_llm(args.model_b, args.key, pdf)
        except Exception as e:
            print(f"  {args.model_b} FAILED: {e}")
            continue

        rows = compare_extractions(a_rec, b_rec)
        agree = sum(1 for r in rows.values() if r[2])
        total_fields = len(rows)

        print(f"\n  Latency:  {args.model_a:<24} {a_dt:5.2f}s     {args.model_b:<24} {b_dt:5.2f}s")
        print(f"  Agreement: {agree}/{total_fields} fields\n")
        print(f"  {'FIELD':<18} {args.model_a:<35} {args.model_b:<35} OK")
        print(f"  {'-'*18} {'-'*35} {'-'*35} --")
        for k, (va, vb, ok) in rows.items():
            mark = " OK " if ok else "DIFF"
            print(f"  {k:<18} {short(va):<35} {short(vb):<35} {mark}")

        overall.append({
            "pdf": pdf.name,
            "agreement": f"{agree}/{total_fields}",
            "a_latency": a_dt,
            "b_latency": b_dt,
        })

    if overall:
        print(f"\n{'='*80}\n  SUMMARY\n{'='*80}")
        print(f"  {'PDF':<40} {'agree':<12} {args.model_a + ' s':<18} {args.model_b + ' s'}")
        for o in overall:
            print(f"  {o['pdf']:<40} {o['agreement']:<12} {o['a_latency']:<18.2f} {o['b_latency']:.2f}")


if __name__ == "__main__":
    main()
