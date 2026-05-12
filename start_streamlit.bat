@echo off
setlocal
cd /d "%~dp0"
echo.
echo  Foundry — PO Capture (Streamlit)
echo  ---------------------------------
echo  Starting Foundry on http://localhost:8502
echo  Press Ctrl+C to stop
echo.
streamlit run app.py
