# Foundry — PO Capture

Drop a PDF purchase order, get structured data extracted by an LLM, review/edit, and append to a rolling Excel ledger.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Streamlit (app.py) — one-command launch             │
│  └─ injects API key from .streamlit/secrets.toml     │
│  └─ inlines all frontend files into one HTML         │
│  └─ renders via streamlit.components.v1.html(...)    │
│         ┌──────────────────────────────────────┐     │
│         │  React app (frontend/)               │     │
│         │  ├─ pdf.js (browser PDF parsing)     │     │
│         │  ├─ OpenRouter (LLM extraction)      │     │
│         │  └─ SheetJS (XLSX export)            │     │
│         └──────────────────────────────────────┘     │
└──────────────────────────────────────────────────────┘
```

The React frontend is fully modular — ~25 small files in `frontend/src/` — and registers components on `window.App` so they can load in dependency order without an ES-module bundler.

## Quick start

```
start_streamlit.bat              # Windows one-click
# OR
streamlit run app.py
```

Then open http://localhost:8502.

## Configure the API key

Two places it can come from (in priority order):

1. **In-app Settings panel** — the cleanest user-facing flow. Saved to browser localStorage. Per-user.
2. **`.streamlit/secrets.toml`** — deployment default for all users. Copy `secrets.toml.example`:
   ```toml
   OPENROUTER_API_KEY = "sk-or-v1-..."
   ```
3. Hardcoded fallback in `frontend/src/lib/config.js` — last resort.

Get a key at <https://openrouter.ai/keys>.

## Try it

Drag any of the three sample POs from this folder onto the dropzone:
- `Meridian_Supply_PO_13214085.pdf` — single line item, $1,432.50
- `Apex_Power_Group_FL_PO_13213236.pdf` — single line item, $15,232 (30 pages, mostly T&Cs)
- `Summit_Industrial_PO_115835 (1).pdf` — 13 line items, $541,010

## Two ways to run

| Mode | Command | Use case |
|---|---|---|
| **Streamlit** (recommended) | `streamlit run app.py` | End users, deployment, secrets management |
| **Static HTTP** (dev) | `cd frontend && python -m http.server 8000` | Frontend-only iteration without Streamlit overhead |

Both modes serve the exact same React app. Streamlit just adds the API-key-from-secrets injection and a cleaner one-command launch.

## Files

```
ParkerJones/
├── app.py                     # Streamlit entry — bundles + serves the React app
├── requirements.txt           # streamlit
├── start_streamlit.bat        # Windows launcher
├── .streamlit/
│   ├── config.toml            # theme, port (8502), runOnSave
│   └── secrets.toml.example   # template for OPENROUTER_API_KEY
└── frontend/
    ├── index.html             # standalone (dev) entry
    ├── styles.css             # design system
    ├── start.bat              # static HTTP launcher (dev)
    └── src/
        ├── lib/               # utils, config, openrouter, pdfParser, excel, hooks
        ├── components/        # 11 atoms (Icon, Button, Card, Dropzone, ...)
        ├── layout/            # Sidebar, TopBar
        ├── features/          # POHeader, LineItemsTable, RepositoryTable, ...
        ├── views/             # UploadView, ReviewView, RepositoryView, SettingsView
        ├── App.jsx            # root component
        └── main.jsx           # boot
```

## What works · what's coming

| Feature | Status |
|---|---|
| Drag-drop PDF upload | ✅ Real |
| Text-based PDF parsing (pdf.js) | ✅ Real |
| LLM extraction (OpenRouter / Claude / GPT) | ✅ Real |
| Editable review form with auto-totals | ✅ Real |
| Two-sheet XLSX export | ✅ Real |
| Local repository persistence | ✅ Real (browser localStorage) |
| Settings: API key, model, ledger management | ✅ Real |
| Scanned PDF / OCR | ⏳ Needs Python backend (Tesseract) |
| DOCX support | ⏳ Needs Python backend (python-docx) |
| OneDrive ledger sync | ⏳ Future (Microsoft Graph API) |
| Multi-rep collaboration | ⏳ Future (shared backend) |
| Re-edit a saved PO | ⏳ Nice-to-have |

## Cost notes

OpenRouter pricing on `claude-sonnet-4.5`:
- ~$0.005 per single-line PO (Meridian)
- ~$0.025 per dense multi-page PO (Apex with T&Cs)
- ~$0.04 per multi-line PO (Summit, 13 lines)

A $5 top-up on OpenRouter is enough for ~150–500 PO extractions depending on size. For testing on the free tier, switch the model to **Claude Haiku 4.5** in Settings — same accuracy on PO extraction, 3× cheaper.
