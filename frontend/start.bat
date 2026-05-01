@echo off
setlocal
cd /d "%~dp0"
echo.
echo  Foundry — PO Capture
echo  -----------------------
echo  Starting local server on http://localhost:8000
echo  Press Ctrl+C to stop
echo.
start "" "http://localhost:8000/"
python -m http.server 8000
