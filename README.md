---
title: Foundry
emoji: 📦
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
short_description: PO extraction app — Parker Jones / Lekson Associates
---

# Foundry — PO Capture

Drop a PDF purchase order, an LLM extracts structured data, review & edit, save to a shared ledger, export to Excel. Hosted on Hugging Face Spaces, data lives in Turso (cloud libSQL). Reps open the Space URL and sign in — no install.

**Live:** https://huggingface.co/spaces/SamTwo/foundry

## Architecture

```
                              ┌──────────────────────┐
                              │  Turso (libSQL)      │
                              │  POs · LineItems     │
                              │  Users               │
                              └──────────┬───────────┘
                                         │ HTTPS
              ┌──────────────────────────┴────────────────────────┐
              │   Hugging Face Space (Docker, port 7860)          │
              │                                                   │
              │   FastAPI (backend.py)                            │
              │     GET  /            → React HTML (frontend_html)│
              │     GET  /api/*       → REST                      │
              │     GET  /api/pos/{id}/source → seed PDF bytes    │
              │                                                   │
              │   Seed PDFs baked into the image at files/        │
              └──────────────────────────┬────────────────────────┘
                                         │ HTTPS
                                ┌────────┴────────┐
                                │ Reps' browsers  │
                                └─────────────────┘
```

One Docker process serves the whole single-page app on port 7860. No separate frontend build step — React is loaded from CDN and Babel transpiles JSX in the browser.

## What's where

```
ParkerJones/
├── backend.py              # FastAPI — auth, PO CRUD, Excel export, serves SPA at /
├── frontend_html.py        # Builds the React HTML payload (used by FastAPI + Streamlit)
├── auth.py                 # JWT + bcrypt + invitation YAML
├── db.py                   # Dispatcher → db_sqlite OR db_turso
├── db_sqlite.py            # Local dev fallback (offline)
├── db_turso.py             # Production DB (cloud libSQL)
├── excel_export.py         # XLSX builder (openpyxl)
├── app.py                  # Streamlit dev entry — only used locally
├── Dockerfile              # Production image for HF Spaces
├── requirements.txt
├── users.yaml.example      # Invitation list template (real users.yaml is gitignored)
├── scripts/
│   └── migrate_sqlite_to_turso.py
├── .streamlit/
│   ├── config.toml
│   └── secrets.toml.example
├── files/                  # Seed source PDFs (one per historical PO, named {po_id}.pdf)
└── frontend/
    ├── styles.css
    └── src/
        ├── App.jsx, main.jsx
        ├── lib/             # utils, auth, api, gemini, openrouter, pdfParser
        ├── components/      # atoms (Button, Card, Icon, ...)
        ├── features/        # POHeader, LineItemsTable, RepositoryTable, ...
        ├── layout/          # Sidebar, TopBar
        └── views/           # Upload, Review, Repository, Profile, Team, Settings, Auth
```

## Deploying

Both remotes track `main`:

| Remote | URL | Used for |
|---|---|---|
| `origin` | github.com/0NE-C0DEMAN/ParkerJones | Source of truth, code review |
| `hf` | huggingface.co/spaces/SamTwo/foundry | Production build |

Code-only changes:
```
git push origin main
git push hf main          # or `hf upload SamTwo/foundry path --repo-type=space`
```

New binary files (PDFs, images > ~100 KB): HF rejects plain git pushes for those — use `hf upload` so they route through Xet/LFS.

## HF Space configuration

Secrets are set in **Settings → Variables and secrets** (never commit them):

| Key | Example |
|---|---|
| `FOUNDRY_DB_BACKEND` | `turso` |
| `TURSO_DB_URL` | `libsql://…turso.io` |
| `TURSO_DB_TOKEN` | `eyJ…` |
| `OPENROUTER_API_KEY` | `sk-or-v1-…` or `AIza…` for Gemini |
| `FOUNDRY_JWT_SECRET` | hex from `python -c "import secrets; print(secrets.token_hex(32))"` |

## Local development

```
python -m venv .venv && .venv\Scripts\activate    # PowerShell
pip install -r requirements.txt
cp .streamlit/secrets.toml.example .streamlit/secrets.toml   # then fill in values
cp users.yaml.example users.yaml                              # then list invited emails

# Option A — same single-port architecture as production:
uvicorn backend:app --port 7860
# open http://127.0.0.1:7860

# Option B — Streamlit-driven (auto-spawns FastAPI on 8503):
streamlit run app.py
```

For offline-only development without Turso, set `FOUNDRY_DB_BACKEND = "sqlite"` in `secrets.toml` (or unset). Data lives in `foundry.db` next to the app.

## Source-file persistence

The 5 seed PDFs ship inside the Docker image — they survive every container restart. **New uploads via the web UI write to the same directory but only persist until the next restart** (HF free tier has no persistent disk). To make new uploads durable, switch the source-file backend to an external object store (Cloudflare R2 has a generous free tier); a `backend.py` patch is the work.

## Security

- `users.yaml` and `.streamlit/secrets.toml` are gitignored.
- Passwords are bcrypt-hashed (cost factor 12).
- JWT tokens stored in browser localStorage; default 7-day expiry, configurable via `users.yaml` → `session_days`.
- Source PDFs at `/api/pos/{id}/source` are protected by an unguessable UUID. The frontend iframes them without an `Authorization` header (browsers can't set headers on iframe src).

## License

Internal use only. © Lekson Associates.
