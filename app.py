"""
Foundry — PO Capture
====================
Streamlit wrapper that mounts the modular React frontend AND auto-starts
the FastAPI backend (SQLite + Excel export) as a subprocess. One command
runs the entire app.

Run:
    streamlit run app.py

Architecture:
    streamlit run app.py
        ├─ subprocess: uvicorn backend:app --port 8503  (SQLite + REST API)
        └─ components.v1.html → React iframe (port 8502)
              └─ fetch('http://localhost:8503/api/...')
"""
from __future__ import annotations

import json
import socket
import subprocess
import sys
import time
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

ROOT = Path(__file__).parent
FRONTEND = ROOT / "frontend"
BACKEND_PORT = 8503

# ---------------------------------------------------------------------------
# Page setup — strip ALL Streamlit chrome, hide outer scroll
# ---------------------------------------------------------------------------
st.set_page_config(
    page_title="Foundry — PO Capture",
    page_icon="📦",
    layout="wide",
    initial_sidebar_state="collapsed",
)

st.markdown(
    """
<style>
  /* Hide every bit of Streamlit's UI — header, footer, toolbar, decoration */
  #MainMenu, header, footer, .stDeployButton,
  [data-testid="stToolbar"], [data-testid="stDecoration"],
  [data-testid="stHeader"], [data-testid="stStatusWidget"],
  [data-testid="stSidebarNav"] {
    display: none !important;
  }
  /* Strip default padding from every Streamlit container in the chain */
  .block-container, section.main > div.block-container,
  .main .block-container, [data-testid="stAppViewContainer"] > section > div,
  [data-testid="stVerticalBlock"], [data-testid="element-container"] {
    padding: 0 !important;
    max-width: 100% !important;
    gap: 0 !important;
  }
  /* Force every container in the iframe-ancestor chain to fill the viewport
     so the iframe itself can take exactly 100vh — no cropping, no double
     scroll. */
  html, body, #root,
  [data-testid="stApp"],
  [data-testid="stAppViewContainer"],
  [data-testid="stMain"],
  section.main,
  .main,
  [data-testid="stMainBlockContainer"],
  .block-container,
  [data-testid="stVerticalBlockBorderWrapper"],
  [data-testid="stVerticalBlock"],
  [data-testid="element-container"],
  [data-testid="stIFrame"] {
    margin: 0 !important;
    padding: 0 !important;
    height: 100vh !important;
    max-height: 100vh !important;
    overflow: hidden !important;
  }
  iframe {
    width: 100% !important;
    height: 100vh !important;
    min-height: 100vh !important;
    max-height: 100vh !important;
    border: 0 !important;
    display: block !important;
  }
</style>
""",
    unsafe_allow_html=True,
)

# ---------------------------------------------------------------------------
# Backend auto-spawn — single command runs the whole app
# ---------------------------------------------------------------------------
def _is_port_open(host: str, port: int, timeout: float = 0.4) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


@st.cache_resource(show_spinner="Starting backend...")
def _ensure_backend() -> dict:
    """Start the FastAPI backend on BACKEND_PORT if it isn't already up.

    Cached as a resource so subsequent reruns don't respawn. The subprocess
    keeps running for the lifetime of the Streamlit process (or until
    manually killed).
    """
    if _is_port_open("127.0.0.1", BACKEND_PORT):
        return {"status": "already_running", "port": BACKEND_PORT}

    proc = subprocess.Popen(
        [
            sys.executable, "-m", "uvicorn", "backend:app",
            "--port", str(BACKEND_PORT),
            # Bind to 0.0.0.0 (all IPv4 interfaces) so the iframe can reach
            # us regardless of how `localhost` resolves on the user's machine.
            "--host", "0.0.0.0",
            "--log-level", "warning",
        ],
        cwd=str(ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    # Wait briefly for the port to come up
    for _ in range(40):
        if _is_port_open("127.0.0.1", BACKEND_PORT):
            return {"status": "spawned", "port": BACKEND_PORT, "pid": proc.pid}
        time.sleep(0.15)
    return {"status": "timeout", "port": BACKEND_PORT, "pid": proc.pid}


_backend_status = _ensure_backend()


# ---------------------------------------------------------------------------
# Bundle the frontend into one HTML payload
# ---------------------------------------------------------------------------
FILES_PURE_JS = [
    "src/lib/utils.js",
    "src/lib/config.js",
    "src/lib/api.js",
    "src/lib/pdfParser.js",
    "src/lib/openrouter.js",
    "src/lib/mockData.js",
    "src/lib/mockApi.js",
    "src/lib/excel.js",
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
    "src/layout/Sidebar.jsx",
    "src/layout/TopBar.jsx",
    "src/features/POHeader.jsx",
    "src/features/AddressBlock.jsx",
    "src/features/LineItemsTable.jsx",
    "src/features/ProcessingState.jsx",
    "src/features/RecentUploadsList.jsx",
    "src/features/RepositoryTable.jsx",
    "src/features/PdfPreview.jsx",
    "src/views/UploadView.jsx",
    "src/views/ReviewView.jsx",
    "src/views/RepositoryView.jsx",
    "src/views/SettingsView.jsx",
    "src/App.jsx",
    "src/main.jsx",
]


def _read(rel: str) -> str:
    p = FRONTEND / rel
    if not p.exists():
        st.error(f"Missing frontend file: {rel}")
        st.stop()
    return p.read_text(encoding="utf-8")


def _streamlit_api_key() -> str:
    try:
        return st.secrets.get("OPENROUTER_API_KEY", "") or ""
    except Exception:
        return ""


def build_app_html() -> str:
    css = _read("styles.css")
    pure_js = "\n".join(
        f'<script>\n/* {p} */\n{_read(p)}\n</script>' for p in FILES_PURE_JS
    )
    jsx = "\n".join(
        f'<script type="text/babel" data-presets="env,react">\n/* {p} */\n{_read(p)}\n</script>'
        for p in FILES_JSX
    )

    api_key = _streamlit_api_key()
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


# ---------------------------------------------------------------------------
# Render — iframe sized to fit a typical viewport. The internal CSS layout
# pins the sidebar full-height; only .main scrolls.
# ---------------------------------------------------------------------------
components.html(build_app_html(), height=880, scrolling=False)
