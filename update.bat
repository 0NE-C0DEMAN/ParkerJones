@echo off
setlocal
cd /d "%~dp0"
echo.
echo  Foundry — update
echo  ----------------
echo  Pulling latest code from GitHub...
echo.
git pull
if errorlevel 1 (
  echo.
  echo  Pull failed. If this is your first time, run setup.bat instead.
  pause
  exit /b 1
)
echo.
echo  Installing any new dependencies...
python -m pip install -r requirements.txt
echo.
echo  Update complete. Launch the app with start_streamlit.bat.
echo.
pause
