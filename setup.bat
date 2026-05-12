@echo off
setlocal
cd /d "%~dp0"
echo.
echo  Foundry — first-time setup
echo  --------------------------
echo  Installing Python dependencies...
echo.
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo  Setup failed. Make sure Python 3.11+ is installed and on your PATH.
  echo  Download from https://www.python.org/downloads/
  pause
  exit /b 1
)
echo.
echo  Setup complete!
echo.
echo  Next step:
echo    1. Make sure .streamlit\secrets.toml exists with your LLM API key
echo       and JWT secret. (Copy .streamlit\secrets.toml.example as a
echo       starting point and fill in the values.)
echo    2. Make sure users.yaml exists with the invitation list.
echo       (Copy users.yaml.example as a starting point.)
echo    3. Double-click start_streamlit.bat to launch the app.
echo.
pause
