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

import socket
import subprocess
import sys
import time
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

import frontend_html

ROOT = Path(__file__).parent
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
# Render — iframe sized to fit a typical viewport. The internal CSS layout
# pins the sidebar full-height; only .main scrolls.
#
# The HTML payload itself lives in frontend_html.py so backend.py can serve
# the same single-page app at "/" on hosted deploys (Hugging Face Spaces),
# where there's no Streamlit at all.
# ---------------------------------------------------------------------------
def _streamlit_api_key() -> str:
    try:
        return st.secrets.get("OPENROUTER_API_KEY", "") or ""
    except Exception:
        return ""


components.html(
    frontend_html.build_app_html(api_key=_streamlit_api_key()),
    height=880,
    scrolling=False,
)
