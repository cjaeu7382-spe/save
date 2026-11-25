@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  start "Frame Lab Local Server" /min py -m http.server 8000 --bind 127.0.0.1
) else (
  where python >nul 2>nul
  if %errorlevel%==0 (
    start "Frame Lab Local Server" /min python -m http.server 8000 --bind 127.0.0.1
  ) else (
    echo Python is not installed or is not on PATH.
    echo Install Python, then run this file again.
    pause
    exit /b 1
  )
)

timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:8000/
echo Frame Lab is running at http://127.0.0.1:8000/
echo Close the "Frame Lab Local Server" window to stop the local server.
endlocal
