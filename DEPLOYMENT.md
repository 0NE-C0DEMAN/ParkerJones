# Foundry — Deployment Guide

Everything you need to know about how Foundry is built, deployed, and operated on Hugging Face Spaces. Written for whoever picks this up after the original deploy — every step we ran, every flag we set, why we set it.

**Live Space:** https://huggingface.co/spaces/SamTwo/foundry

---

## 1. Architecture at a glance

```
   ┌──────────────────────────────────────────────────────────────────┐
   │  HF Space:  SamTwo/foundry   (Docker SDK, port 7860)             │
   │                                                                  │
   │  Single uvicorn process (CMD: uvicorn backend:app --port 7860)   │
   │                                                                  │
   │     ┌──────────────────────────────────────────────────┐         │
   │     │  FastAPI  (backend.py)                           │         │
   │     │   GET  /              → React HTML (one bundle)  │         │
   │     │   GET  /api/auth/*    → login, me, password      │         │
   │     │   GET  /api/pos       → list PO records          │         │
   │     │   POST /api/pos       → create from extraction   │         │
   │     │   GET  /api/team      → admin: list users        │         │
   │     │   ...                                            │         │
   │     └──────────────────────────────────────────────────┘         │
   │                                                                  │
   │  Read-write volume mounts (managed by HF):                       │
   │    /home/user/app/data    ← hf://buckets/SamTwo/foundry-db       │
   │    /home/user/app/files   ← hf://buckets/SamTwo/foundry-sources  │
   │                                                                  │
   │  Reads/writes:                                                   │
   │    db_sqlite.py   → /home/user/app/data/foundry.db               │
   │    backend.py     → /home/user/app/files/{po_id}.pdf             │
   └──────────────────────────────────────────────────────────────────┘

   The browser runs the React SPA. Babel-Standalone transpiles JSX in the
   browser at load time — no build step, no bundler, no Node tooling.
```

Two private Hugging Face Storage Buckets hold the durable state:

| Bucket | Mount path | Contents |
|---|---|---|
| `SamTwo/foundry-db` | `/home/user/app/data` | `foundry.db` (SQLite — users, POs, line items, app_config) |
| `SamTwo/foundry-sources` | `/home/user/app/files` | source PDFs, one per PO (`{po_id}.pdf`) |

Bucket usage at the time of writing is under 1 MB — well inside the free 100 GB private quota.

---

## 2. Repo layout (deploy-relevant files)

```
ParkerJones/
├── Dockerfile               # Production image — HF runs this
├── README.md                # Space metadata header (SDK, port, emoji, etc.)
├── requirements.txt         # pip deps installed into the image
├── backend.py               # FastAPI app, serves SPA + API on one port
├── frontend_html.py         # Builds the inlined React HTML payload
├── auth.py                  # JWT + bcrypt
├── db.py                    # Trivial shim — re-exports db_sqlite
├── db_sqlite.py             # The only DB backend — honours FOUNDRY_SQLITE_PATH
├── excel_export.py          # openpyxl xlsx builder
└── frontend/                # React SPA source (loaded by frontend_html.py)
```

There's no `node_modules`, no `dist/`, no compiled bundle in git. Everything ships as source.

---

## 3. Two git remotes

| Remote | URL | Purpose |
|---|---|---|
| `origin` | https://github.com/0NE-C0DEMAN/ParkerJones | Source of truth, code review, history |
| `hf` | https://huggingface.co/spaces/SamTwo/foundry | Production — HF auto-rebuilds on push |

Set up once (already done — these commands are here for reference / if the remote ever needs re-adding):

```bash
git remote add origin https://github.com/0NE-C0DEMAN/ParkerJones.git
git remote add hf     https://huggingface.co/spaces/SamTwo/foundry
```

Both track `main`. The deploy verb is **two pushes**:

```bash
git push origin main          # GitHub (source of truth)
git push hf     main          # HF Space (triggers production rebuild)
```

The HF push triggers a Docker rebuild on the Space (usually 30–60 s). The Space serves the previous version until the new image is up, then swaps in.

---

## 4. The Docker image (what `git push hf main` builds)

The full Dockerfile is in the repo. Key points:

```Dockerfile
FROM python:3.11-slim

# HF runs containers as a non-root user (UID 1000). Work under $HOME so the
# user owns the directory tree — otherwise mkdir/etc. fail with EACCES.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH
WORKDIR $HOME/app

# Layer-cached: deps install only changes when requirements.txt does
COPY --chown=user:user requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt

# App code
COPY --chown=user:user . .

ENV PORT=7860
EXPOSE 7860
CMD ["sh", "-c", "uvicorn backend:app --host 0.0.0.0 --port ${PORT:-7860}"]
```

Build time is dominated by `pip install` (~30 s cold, near-instant on cache hits). The `--chown=user:user` on the COPY lines makes everything writable by the runtime user, so `backend.py` can `mkdir` `./files` and write PO source PDFs at runtime.

---

## 5. Space metadata (README.md header)

HF reads the YAML header of `README.md` to configure the Space. Ours:

```yaml
---
title: Foundry
emoji: 📦
colorFrom: indigo
colorTo: purple
sdk: docker            # ← tells HF to use the Dockerfile (vs Streamlit/Gradio SDKs)
app_port: 7860         # ← the port HF exposes to the browser
pinned: false
short_description: PO extraction app — Parker Jones / Lekson Associates
---
```

Changing any of these requires a push (and HF reads them from the `hf` remote, not GitHub). Don't change `sdk` to anything but `docker` — the rest of the deploy assumes our Dockerfile pattern.

---

## 6. Environment variables / secrets

Set in **Space → Settings → Variables and secrets**. **Secrets** are encrypted at rest and never echoed; **variables** are plain env vars. Both show up as process env to uvicorn.

| Key | Type | Value (placeholder) | What it does |
|---|---|---|---|
| `FOUNDRY_DB_BACKEND` | Variable | `sqlite` | Pick the DB driver. Only `sqlite` exists today. |
| `FOUNDRY_SQLITE_PATH` | Variable | `/home/user/app/data/foundry.db` | Absolute path to the SQLite file. Must land inside the mounted `foundry-db` bucket so writes persist. |
| `OPENROUTER_API_KEY` | Secret | `sk-or-v1-…` or `AIza…` | LLM key. Accepts both OpenRouter and Gemini keys — the frontend routes per-model. Fallback if no in-app override is set. |
| `FOUNDRY_JWT_SECRET` | Secret | 64 hex chars | Signs JWTs. Generate once with `python -c "import secrets; print(secrets.token_hex(32))"`. Rotating it invalidates every active session. |

There's also an in-app override stored in the SQLite `app_config` table — set via **Settings → Foundry Admin → Shared LLM key** in the UI. The resolution order is:

1. `app_config.llm_api_key` (DB-stored, set in the app)
2. `OPENROUTER_API_KEY` env var
3. `GEMINI_API_KEY` env var
4. empty (LLM features disabled until a key is configured)

The DB-stored key takes effect for each user on their next page load. The env-var path is the **fallback** — set it once so a fresh deploy with an empty DB still has working extraction.

---

## 7. Volume mounts (one-time setup)

Volumes are configured once via the HF CLI. They survive container restarts and image rebuilds — only the bucket contents survive, not anything written outside the mount paths.

```bash
# Install the CLI if you don't have it
pip install --upgrade huggingface_hub
huggingface-cli login                # paste a write-scope token

# Bind the buckets to paths inside the container
hf spaces volumes set SamTwo/foundry \
    -v hf://buckets/SamTwo/foundry-sources:/home/user/app/files \
    -v hf://buckets/SamTwo/foundry-db:/home/user/app/data

# Verify
hf spaces volumes ls SamTwo/foundry
# Expected output:
#   foundry-sources  →  /home/user/app/files
#   foundry-db       →  /home/user/app/data
```

If `hf spaces volumes ls` ever comes back empty, the Space is running on ephemeral storage — re-applying the mount config above is the fix. No data is lost as long as the buckets exist; they're decoupled from the Space.

The two buckets themselves were created from the HF web UI ([huggingface.co/storage-buckets](https://huggingface.co/storage-buckets)) as **private** buckets in the `SamTwo` namespace. No special configuration — defaults (versioning off, no public access).

---

## 8. First-time deployment checklist

The order matters — environment + mounts before first boot, otherwise the container starts against a writeable-but-empty `/home/user/app/data` and creates a fresh `foundry.db` that won't persist.

1. **Create the two buckets** at huggingface.co/storage-buckets:
   - `SamTwo/foundry-db` (private)
   - `SamTwo/foundry-sources` (private)
2. **Create the Space** at huggingface.co/new-space:
   - Name: `foundry`, Owner: `SamTwo`
   - SDK: **Docker**
   - Visibility: **Public** (URL is unguessable to non-team members; auth is enforced by the app)
   - Hardware: **CPU basic** (free tier — plenty for this workload)
3. **Set volume mounts** (CLI snippet in §7).
4. **Set secrets** in Space Settings → Variables and secrets (table in §6).
5. **Add the remote and push for the first time**:
   ```bash
   git remote add hf https://huggingface.co/spaces/SamTwo/foundry
   git push hf main
   ```
6. **Wait** for the Build logs to go from "Building" → "Running" (≈60 s).
7. **Open the Space** and create the first admin account through the auth UI (or directly via SQL — see §13).
8. **Verify**: log in, upload a PO, refresh — record should still be there. That proves the bucket mount worked.

---

## 9. Day-to-day deploys

Almost every change is code-only. The flow:

```bash
# 1. Make your edits, commit on main
git add <files>
git commit -m "What changed and why"

# 2. Push to both remotes
git push origin main          # GitHub
git push hf     main          # HF — triggers rebuild
```

We've been doing both pushes in one shell call:

```bash
git push origin main && git push hf main
```

If a push to `hf` fails with "remote rejected (LFS)", the commit included a binary > ~100 KB that HF wants routed through LFS/Xet. The fix is **either** to leave the binary out of git **or** to upload it via `hf upload`:

```bash
hf upload SamTwo/foundry path/to/big.bin path/to/big.bin --repo-type=space
```

That's only relevant for embedded PDFs / images — every code change goes through plain git.

---

## 10. The build cycle on HF

Once `git push hf main` lands, HF Spaces:

1. **Detects** the push and starts a build (visible in the Space's **Logs** tab → Build).
2. **Pulls** the new HEAD, builds the Docker image:
   - Base layer + `pip install` — cache hit on most pushes (requirements.txt rarely changes)
   - `COPY . .` — invalidates whenever any source file changes (every push)
3. **Starts** a new container with the image, runs the `CMD` line.
4. **Health-checks** by attempting to connect to `app_port` (7860). If the container exits or doesn't bind in time, HF rolls back to the previous build.
5. **Swaps in** the new container once it answers — the public URL stays up the whole time.

Typical total turnaround: 30–60 s. Cache misses on `requirements.txt` (which happen when we bump a dep) push it to ~90 s.

---

## 11. Cache-busting on the frontend

The single-page-app HTML is built fresh per request by `frontend_html.build_app_html()`. Without explicit headers, browsers will happily serve a cached old bundle even after a successful rebuild — so we explicitly tell them not to:

```python
# backend.py
@app.get("/", response_class=HTMLResponse)
def index():
    ...
    return HTMLResponse(
        content=html,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )
```

The React/Babel CDN scripts referenced *inside* the HTML still cache normally (they're long-term-immutable). Only the inlined JSX bundle is no-store. Net effect: pushing to HF takes effect on the rep's next page reload — no `Ctrl+Shift+R` needed, no manual cache nuke.

---

## 12. Database schema and migrations

Schema lives in `db_sqlite.py`:

- `init()` runs at FastAPI startup (`@app.on_event("startup")`). It `CREATE TABLE IF NOT EXISTS` every table, then applies migrations.
- **Migrations** are a Python list of `(column_name, column_ddl)` pairs (`PO_MIGRATIONS`, `LINE_MIGRATIONS`, `USER_MIGRATIONS`). For each entry, `init()` checks `PRAGMA table_info` and `ALTER TABLE ADD COLUMN` if the column is missing. SQLite handles `ADD COLUMN` cheaply — old rows get NULL for the new column.
- We **never drop columns** and **never rename them**. SQLite makes both surgery, and there's no rollback if the migration fails partway through. Add new columns; if a name is wrong, add another and leave the old one to rot.

This means deploying schema changes is the same as deploying code changes — just push and HF rebuilds. The new `init()` runs once on container startup, alters tables in place, and serves traffic.

Defensive read-time coalesce: any column added by ALTER TABLE without a default can be NULL on older rows. `db_sqlite._row_to_po` and `_list_lines` map those NULLs to `""` / `0` before they hit the Pydantic response model — otherwise FastAPI would 500 on rows older than the migration.

---

## 13. One-time admin tasks

### Create the first admin account

Open the Space's auth screen — but the UI has no "sign up" button (accounts are admin-created). On a fresh deploy with an empty DB, bootstrap from a local shell against the Space's filesystem:

The cleanest way is to do it before first deploy, against the seed `foundry.db` you push up. Locally:

```bash
python - <<'EOF'
import auth
auth.create_user(
    email="parker@lekson.com",
    full_name="Parker Jones",
    password="<temp-password>",
    role="admin",
)
EOF
```

That `foundry.db` file then needs to land in the bucket — easiest path is to `hf upload` it once into `foundry-db`.

After the first admin exists, every subsequent user is created from the in-app **Team** page (admin → "Add user").

### Reset an admin's password from outside the UI

If Parker locks himself out:

```bash
python - <<'EOF'
import auth, db
u = db.find_user_by_email("parker@lekson.com")
auth.admin_set_password(u["id"], "<new-temp-password>")
EOF
```

…again, this runs against whatever `foundry.db` the script can see, so for production you'd need to pull the file out of the bucket, edit, and push it back. Easier path: ask any other admin to reset Parker's password via the Team page.

### Rotate the LLM key

**In-app:** Settings → Foundry Admin → "Set a new key" — instant for every user on their next reload.

**Via secret:** Update `OPENROUTER_API_KEY` in Space Settings, then restart the Space (Space Settings → Restart Space). New value picked up at next process start. Only relevant if the in-app key is unset.

### Clear all POs (nuclear option)

Settings → Foundry Admin → "Clear ledger" — removes every PO + line item and unlinks the source PDFs from `/files`. Asks for confirmation. Audit logs from `created_by_*` are lost when the rows go.

---

## 14. Operations / monitoring

| Question | Where to look |
|---|---|
| "Did my push deploy?" | Space → Logs → Build. Success looks like `===== Application Startup at … ===` followed by `Uvicorn running on http://0.0.0.0:7860`. |
| "Is the live app up?" | `curl https://samtwo-foundry.hf.space/api/health` should return `{"status":"ok"}`. |
| "What's in the bucket?" | The buckets aren't browsable from the web UI; the only practical view is `hf api ...` from CLI, or open a one-off Space terminal session via the HF UI. |
| "Did the DB migration apply?" | First lines of the Space Logs → Container after a rebuild show `[db] Using SQLite backend.` followed by no errors. A failed `ALTER TABLE` would show as a stack trace at startup and the Space would refuse to come up. |
| "How many POs/users right now?" | Settings → Foundry Admin shows POs / line items / suppliers / active users. |
| "Why is the LLM not responding?" | Settings → Foundry Admin → Shared LLM key. Source should be `db` or `env`. If `none`, set one and refresh. |

There's no separate logging/observability stack — HF Spaces logs are the source of truth. If we ever outgrow that, the natural next step is to ship logs to a managed Sentry or Logflare from inside `backend.py`.

---

## 15. Rolling back a bad deploy

HF stores every previous image. To revert:

1. Open the Space.
2. **Settings** → scroll to **Restart** / **Factory Reboot** section.
3. Or — push the previous commit:
   ```bash
   git reset --hard <previous-good-sha>
   git push hf main --force
   ```

Force-pushing is fine to the `hf` remote — it's not a shared dev branch, just the production artifact. `origin` we treat as append-only, so for `origin` use a revert commit instead:

```bash
git revert <bad-sha>
git push origin main
```

If the bad deploy mangled DB data (rare — we don't run destructive migrations), restore from the bucket's previous version (HF Buckets keep prior versions automatically; recovery is via the HF support flow today since there's no first-class restore UI).

---

## 16. Reproducing the production environment locally

```bash
# Same uvicorn command as the container's CMD
export FOUNDRY_SQLITE_PATH="$PWD/foundry.db"
uvicorn backend:app --host 0.0.0.0 --port 7860
# open http://127.0.0.1:7860
```

That's it — `pip install -r requirements.txt`, set `FOUNDRY_SQLITE_PATH` (otherwise the app picks the default `./foundry.db`), and run. Same code path as HF, same DB driver, same single-port arrangement. The only difference is no volume mount — the DB file lives wherever the env var points instead of inside a bucket.

For the development UX (auto-reload, browser-attached extensions), use Streamlit instead:

```bash
streamlit run app.py
# Streamlit auto-spawns uvicorn on 8503 + iframes the SPA
```

Streamlit isn't invoked at all in production; it's a dev convenience.

---

## 17. Tear-down (in case we ever migrate off HF)

Backwards of §8:

1. `hf upload` the latest `foundry.db` and the `files/` tree to somewhere safe (S3, local disk).
2. Pause the Space (Space Settings → Pause). The URL stops serving but the buckets and config stay.
3. If permanent, delete the Space and both buckets from the HF UI.
4. Spin up the same Docker image anywhere — the only HF-specific bits are the two volume mount paths (which are just plain directories from the container's perspective).

The app has zero HF-platform-specific code. Move the buckets to any object store and it'll run.

---

## 18. Deployment changelog (notable production milestones)

A rough timeline of what we've shipped, mostly for context if a future contributor is staring at the git log wondering why something is the way it is.

| Milestone | Why |
|---|---|
| Switch from Streamlit-only to single-port FastAPI | One process, one port — HF Spaces is simpler with a single web server. Streamlit stayed as the local dev entry. |
| HF Storage Buckets mounted for `foundry.db` + `files/` | Without them, every Space restart wiped the DB and uploaded PDFs. |
| `Cache-Control: no-store` on the SPA HTML | Stop browsers from holding onto the old JS bundle after a push. |
| Schema migrations via ALTER TABLE ADD COLUMN | Adding new PO fields (supplier_code, freight_terms, ship_via, …) without breaking older rows. |
| NULL-coalesce at the DB read boundary | Older rows had NULL in newly-added columns; Pydantic was 500-ing on validation. |
| Refactor `Button`/`Input`/`Card`/`Badge`/`Autocomplete` away from `…rest` destructure | Babel-Standalone emits `_excluded` at the script-tag top level; every script collided on `window._excluded` so all earlier components were stripping the wrong props and leaking non-DOM attrs into HTML. |
| Single Description field (drop Customer Part + Vendor Part columns) | Parker's reps want the raw PO line as one block. LLM prompt updated to never split. |
| Soft-delete users (`deleted_at` + parked email) | Admins can remove an account without losing the `created_by_*` audit trail on every PO that user touched. |
| Admin-only self-service email change | Reps' email = their sign-in handle, set by an admin. Only admins can rebind their own email (password-confirmed). |
| Mobile-first responsive pass (≤ 640px) | Off-canvas sidebar drawer; Data/Ledger/Team tables → vertical card lists; everything else stacks. Desktop untouched. |

---

## 19. Quick reference (the whole flow in 8 lines)

```bash
# After making a code change:
git add <files>
git commit -m "..."
git push origin main          # GitHub
git push hf     main          # HF — triggers Docker rebuild on the Space

# Watch the deploy:
#   Space → Logs → Build  (≈30–60 s)

# Done. Reps see the change on their next page reload.
```
