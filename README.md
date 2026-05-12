---
title: Foundry
emoji: 📦
colorFrom: indigo
colorTo: violet
sdk: docker
app_port: 7860
pinned: false
short_description: PO extraction app — Parker Jones / Lekson Associates
---

# Foundry — PO Capture

Drop a PDF purchase order, an LLM extracts structured data, review & edit, save to a shared ledger. Hosted on Hugging Face Spaces; data lives in Turso (cloud libSQL). Each rep just opens the Space URL and signs in — no install required.

## Architecture

```
                   ┌────────────────────────────────┐
                   │  Google Sheet (cloud)          │
                   │  "Foundry — PO Ledger"         │
                   │  Tabs: POs, LineItems, Users   │
                   │  Owned by admin, shared with   │
                   │  service account               │
                   └─────────────┬──────────────────┘
                                 │ Sheets API
            ┌────────────────────┼────────────────────┐
            ▼                    ▼                    ▼
     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
     │ Rep 1's PC   │     │ Rep 2's PC   │     │ Rep N's PC   │
     │ Foundry app  │     │ Foundry app  │     │ Foundry app  │
     │ localhost    │     │ localhost    │     │ localhost    │
     └──────────────┘     └──────────────┘     └──────────────┘
```

Each rep installs the app once; from then on it auto-syncs with the shared Sheet. Free forever, no servers to host.

## What you need

- Python 3.11+ ([download](https://www.python.org/downloads/))
- A Google Account (for the shared Sheet)
- A free Google Cloud project (one-time setup by the admin)
- An OpenRouter or Gemini API key (free tiers work fine)

## One-time admin setup

Done once by Parker / the admin.

### 1. Create the Google Cloud project + service account

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a new project ("foundry-parker" or similar).
2. **APIs & Services → Library:** enable **Google Sheets API** and **Google Drive API**.
3. **APIs & Services → Credentials → + Create credentials → Service account.** Name it `foundry-app`. Skip the optional steps, click Done.
4. Click the service account → **Keys → Add key → Create new key → JSON.** A JSON file downloads. Keep it safe; never commit it.

### 2. Create the shared Google Sheet

1. Open [sheets.google.com](https://sheets.google.com) → New blank sheet → rename to "Foundry — PO Ledger".
2. **Share** → paste the service account email (from the JSON's `client_email`, looks like `foundry-app@foundry-parker.iam.gserviceaccount.com`) → set as **Editor** → uncheck "Notify people" → Send.
3. Copy the sheet ID from the URL: `https://docs.google.com/spreadsheets/d/{THIS_PART}/edit`.

### 3. Distribute to your reps

You need to send each rep:
- The full project folder (clone from GitHub or zip it)
- A `.streamlit/secrets.toml` file with:
  - The OpenRouter / Gemini API key
  - `FOUNDRY_DB_BACKEND = "sheets"`
  - The Sheet ID
  - The service account JSON (under `[gcp_service_account]`)
- An entry for them in `users.yaml` (see below)

A template is at `.streamlit/secrets.toml.example` — copy + fill in.

### 4. Edit `users.yaml`

Add each rep's email and role:

```yaml
invited:
  - email: parker@lekson.com
    role: admin
    name: Parker Jones
  - email: jane@lekson.com
    role: rep
    name: Jane Doe
  # ...

require_invitation: true
default_role: rep
session_days: 7
jwt_secret: "{run: python -c \"import secrets; print(secrets.token_hex(32))\"}"
```

### 5. Initialize the sheet

Once your `secrets.toml` is in place:

```
python -c "import db; db.init()"
```

This creates the three tabs (POs, LineItems, Users) with proper headers, idempotently.

### 6. Optionally migrate existing local data

If you've been using SQLite during dev and want to copy your data into the Sheet:

```
python migrate_sqlite_to_sheets.py --dry-run    # preview
python migrate_sqlite_to_sheets.py              # actually copy
```

Safe to re-run — skips rows whose `id` is already in the sheet.

## Per-rep setup (5 minutes per machine)

Each rep installs the app on their own laptop. **They never need to touch any GCP / Google Cloud stuff.**

1. Install Python 3.11+ from [python.org](https://www.python.org/downloads/) (one-time per machine).
2. Either:
   - `git clone https://github.com/0NE-C0DEMAN/ParkerJones.git`
   - or download the ZIP from GitHub
3. Drop the `.streamlit/secrets.toml` Parker emailed into the `.streamlit/` folder.
4. Double-click **`setup.bat`** (installs Python dependencies).
5. Double-click **`start_streamlit.bat`** to launch.
6. Browser opens at `http://localhost:8502`.
7. Click **Create account**, register with their invited email + a password.
8. Done. They're in.

## Updates

When the admin pushes new code to GitHub:

```
double-click update.bat
```

That runs `git pull` + reinstalls any new dependencies. Restart the app and they have the new version.

## Switching backends

The app supports two storage modes:

| Mode | When to use | How to switch |
|---|---|---|
| **SQLite** (local file) | Local dev or single-user demo | `FOUNDRY_DB_BACKEND = "sqlite"` in `secrets.toml` (or unset) |
| **Sheets** (shared cloud) | Multi-user prod | `FOUNDRY_DB_BACKEND = "sheets"` in `secrets.toml` + `[gcp_service_account]` block |

The frontend, auth, extraction pipeline, and Excel export work identically with either backend.

## File layout

```
ParkerJones/
├── app.py                     # Streamlit entry — auto-spawns the FastAPI backend
├── backend.py                 # FastAPI routes
├── auth.py                    # JWT, bcrypt, YAML invitation check
├── db.py                      # Dispatcher — picks SQLite or Sheets
├── db_sqlite.py               # SQLite implementation
├── db_sheets.py               # Google Sheets implementation
├── excel_export.py            # XLSX builder (openpyxl)
├── migrate_sqlite_to_sheets.py  # One-shot SQLite → Sheets copy
├── users.yaml                 # Invitation list (gitignored)
├── users.yaml.example         # Template
├── requirements.txt
├── setup.bat                  # First-time install
├── update.bat                 # Pull latest + reinstall
├── start_streamlit.bat        # Launch the app
├── .streamlit/
│   ├── config.toml            # Theme + port
│   └── secrets.toml           # API key + Sheet config (gitignored)
└── frontend/                  # React app (loaded via Babel-from-CDN)
    ├── styles.css
    ├── index.html
    └── src/
        ├── App.jsx
        ├── main.jsx
        ├── lib/               # utils, auth, gemini, openrouter, api, pdfParser
        ├── components/        # Icon, Button, Card, Badge, Dropzone, ...
        ├── features/          # POHeader, LineItemsTable, RepositoryTable,
        │                      # Charts, ActivityLog, CommandPalette, ...
        ├── layout/            # Sidebar, TopBar
        └── views/             # Upload, Review, Repository, Profile, Team, Settings
```

## Cost

Free forever for the scale Foundry was built for (10 users, ~1k POs/year):

| | Free tier | Foundry uses |
|---|---|---|
| Google Sheets API | 60 reads/min/user, 60 writes/min/user | < 1/min in practice |
| Google Drive (PDFs) | 15 GB | ~10 MB total |
| Gemini API | 1500 req/day | ~10/day |
| OpenRouter | varies | optional fallback |

No hosting fees because the app runs on each rep's PC.

## Security notes

- `users.yaml` and `.streamlit/secrets.toml` are gitignored — never commit them.
- The service account JSON has Editor access to the Sheet. Treat it like a password. If a rep leaves, rotate the service account and redistribute.
- Passwords are bcrypt-hashed (cost factor 12).
- JWT tokens stored in browser localStorage, expire in 7 days.

## License

Internal use only. © Lekson Associates.
