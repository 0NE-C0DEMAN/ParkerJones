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

Drop a PDF purchase order, an LLM extracts structured data, review & edit, save to a shared ledger, export to Excel. Everything — app, data, source files — runs on Hugging Face. Reps open the Space URL and sign in; no install, no external services.

**Live:** https://huggingface.co/spaces/SamTwo/foundry

## Architecture (all on Hugging Face)

```
   ┌────────────────────────────────────────────────────────────┐
   │  HF Space:  SamTwo/foundry  (Docker, port 7860)            │
   │                                                            │
   │  FastAPI (backend.py)                                      │
   │    GET  /              → React HTML (frontend_html.py)     │
   │    GET  /api/*         → REST                              │
   │                                                            │
   │  Volume mounts (managed by the platform, read-write):      │
   │    /home/user/app/files  ←  hf://buckets/SamTwo/foundry-sources
   │    /home/user/app/data   ←  hf://buckets/SamTwo/foundry-db
   │                                                            │
   │  db_sqlite.py opens   /home/user/app/data/foundry.db       │
   │  backend.py writes    /home/user/app/files/{po_id}.pdf     │
   └────────────────────────────────────────────────────────────┘
```

Two private HF Storage Buckets hold the durable state: one for the SQLite database, one for the uploaded source PDFs. Both are mounted into the Space at boot. Everything sits inside the free 100 GB HF private quota (current usage ~1 MB).

One Docker process serves the whole single-page app on port 7860. No separate frontend build step — React is loaded from CDN and Babel transpiles JSX in the browser.

## What's where

```
ParkerJones/
├── backend.py              # FastAPI — auth, PO CRUD, Excel export, serves SPA at /
├── frontend_html.py        # Builds the React HTML payload (used by FastAPI + Streamlit)
├── auth.py                 # JWT + bcrypt + invitation YAML
├── db.py                   # Trivial shim that re-exports db_sqlite
├── db_sqlite.py            # The only backend — honours FOUNDRY_SQLITE_PATH
├── excel_export.py         # XLSX builder (openpyxl)
├── app.py                  # Streamlit dev entry — only used locally
├── Dockerfile              # Production image for HF Spaces
├── requirements.txt
├── users.yaml.example      # Invitation list template (real users.yaml is gitignored)
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
| `FOUNDRY_DB_BACKEND` | `sqlite` |
| `FOUNDRY_SQLITE_PATH` | `/home/user/app/data/foundry.db` |
| `OPENROUTER_API_KEY` | `sk-or-v1-…` or `AIza…` for Gemini |
| `FOUNDRY_JWT_SECRET` | hex from `python -c "import secrets; print(secrets.token_hex(32))"` |

Volume mounts (set once via CLI; survive restarts):

```
hf spaces volumes set SamTwo/foundry \
    -v hf://buckets/SamTwo/foundry-sources:/home/user/app/files \
    -v hf://buckets/SamTwo/foundry-db:/home/user/app/data
```

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

Local dev defaults to `./foundry.db` (next to the code) when `FOUNDRY_SQLITE_PATH` is unset. Override the path with that env var if you want to share a DB file between dev runs.

## Persistence model

Two private HF Buckets hold all durable state, both mounted into the Space as read-write filesystems:

| Bucket | Mount path | Contains |
|---|---|---|
| `SamTwo/foundry-db` | `/home/user/app/data` | `foundry.db` (SQLite — users, POs, line items) |
| `SamTwo/foundry-sources` | `/home/user/app/files` | source PDFs, one per PO (`{po_id}.pdf`) |

`backend.py` and `db_sqlite.py` use plain local paths — no SDK calls. The platform's mount machinery flushes writes back to the buckets, so:

- New PO inserts persist across container restarts and Space rebuilds
- New PDF uploads through the UI persist the same way
- The Space repo stays code-only — no binary blobs in git, no DB files

Sanity-check that the mount config is still in place:

```
hf spaces volumes ls SamTwo/foundry
```

Storage uses the free 100 GB private quota; current footprint is under 1 MB.

## Security

- `users.yaml` and `.streamlit/secrets.toml` are gitignored.
- Passwords are bcrypt-hashed (cost factor 12).
- JWT tokens stored in browser localStorage; default 7-day expiry, configurable via `users.yaml` → `session_days`.
- Source PDFs at `/api/pos/{id}/source` are protected by an unguessable UUID. The frontend iframes them without an `Authorization` header (browsers can't set headers on iframe src).

## License

Internal use only. © Lekson Associates.
