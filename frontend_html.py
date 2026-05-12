"""
frontend_html.py — Builds the bundled React HTML payload.

Shared by:
  - app.py        (Streamlit dev mode — mounted inside a Streamlit iframe)
  - backend.py    (production / Hugging Face Spaces — served directly at "/")

Pulling this out of app.py means the FastAPI backend can serve the entire
single-page app on the same port (7860 on HF Spaces) — no Streamlit needed
in production.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).parent
FRONTEND = ROOT / "frontend"

# Order matters: pure JS first (sets up window.App.* namespaces), then JSX
# components that depend on them.
FILES_PURE_JS = [
    "src/lib/utils.js",
    "src/lib/config.js",
    "src/lib/auth.js",
    "src/lib/api.js",
    "src/lib/pdfParser.js",
    "src/lib/openrouter.js",
    "src/lib/gemini.js",
    "src/lib/mockApi.js",
]
FILES_JSX = [
    "src/lib/hooks.jsx",
    "src/components/Icon.jsx",
    "src/components/Button.jsx",
    "src/components/Badge.jsx",
    "src/components/Card.jsx",
    "src/components/Input.jsx",
    "src/components/Toast.jsx",
    "src/components/Confidence.jsx",
    "src/components/Stat.jsx",
    "src/components/EmptyState.jsx",
    "src/components/Dropzone.jsx",
    "src/components/Segmented.jsx",
    "src/components/ErrorBoundary.jsx",
    "src/layout/Sidebar.jsx",
    "src/layout/TopBar.jsx",
    # Helpers/atoms first, then composites that depend on them.
    "src/features/StatusPill.jsx",
    "src/features/Autocomplete.jsx",
    "src/features/ActivityLog.jsx",
    "src/features/Charts.jsx",
    "src/features/UploadQueue.jsx",
    "src/features/CommandPalette.jsx",
    "src/features/POHeader.jsx",
    "src/features/AddressBlock.jsx",
    "src/features/LineItemsTable.jsx",
    "src/features/ProcessingState.jsx",
    "src/features/RecentUploadsList.jsx",
    "src/features/RepositoryTable.jsx",
    "src/features/PdfPreview.jsx",
    "src/views/AuthView.jsx",
    "src/views/UploadView.jsx",
    "src/views/ReviewView.jsx",
    "src/views/RepositoryView.jsx",
    "src/views/SettingsView.jsx",
    "src/views/ProfileView.jsx",
    "src/views/TeamView.jsx",
    "src/App.jsx",
    "src/main.jsx",
]


def _read(rel: str) -> str:
    p = FRONTEND / rel
    if not p.exists():
        raise FileNotFoundError(f"Missing frontend file: {rel}")
    return p.read_text(encoding="utf-8")


def build_app_html(api_key: str = "") -> str:
    """Build the full single-page HTML document with React/Babel CDN, all
    component sources inlined, and `window.STREAMLIT_API_KEY` injected for
    the frontend to read."""
    css = _read("styles.css")
    pure_js = "\n".join(
        f'<script>\n/* {p} */\n{_read(p)}\n</script>' for p in FILES_PURE_JS
    )
    jsx = "\n".join(
        f'<script type="text/babel" data-presets="env,react">\n/* {p} */\n{_read(p)}\n</script>'
        for p in FILES_JSX
    )

    api_key_js = f"window.STREAMLIT_API_KEY = {json.dumps(api_key)};"

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>Foundry — PO Capture</title>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">

  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js"></script>

  <style>
{css}

/* Iframe fits the parent perfectly — no body scroll, only .main scrolls */
html, body {{
  height: 100vh !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
}}
.app {{
  height: 100vh !important;
}}
  </style>
</head>
<body>
  <div id="root">
    <div style="height:100vh;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-family:Inter,system-ui;font-size:13px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:14px;height:14px;border-radius:50%;border:2px solid #4f46e5;border-bottom-color:transparent;animation:spin 700ms linear infinite;"></div>
        Loading Foundry...
      </div>
    </div>
  </div>
  <style>@keyframes spin {{ to {{ transform: rotate(360deg); }} }}</style>

  <script>
    {api_key_js}
    // Tell Streamlit to size the iframe to the actual window height so the
    // sidebar always fills the viewport and we don't get double scrollbars.
    // (no-op when served directly outside Streamlit — postMessage just goes nowhere)
    function _foundryResize() {{
      const h = Math.max(window.innerHeight, document.documentElement.clientHeight);
      try {{
        window.parent.postMessage({{ type: 'streamlit:setFrameHeight', height: h }}, '*');
      }} catch (e) {{ /* same-origin issues — ignore */ }}
    }}
    window.addEventListener('load', _foundryResize);
    window.addEventListener('resize', _foundryResize);
  </script>

  <!-- Pure JS: utils, config, api (backend client), pdfParser, openrouter, excel, mock -->
  {pure_js}

  <!-- JSX: hooks, components, layout, features, views, App, main -->
  {jsx}
</body>
</html>"""
