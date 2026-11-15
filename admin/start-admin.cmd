@echo off
rem Double-click to start the Dreamy Stories admin panel.
rem Keep this file ASCII-only: cmd.exe misreads non-ASCII text after chcp 65001.
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules\" (
  echo First run: installing dependencies, please wait...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo Could not install dependencies. Install Node.js 22.18 or newer: https://nodejs.org
    pause
    exit /b 1
  )
)
echo Starting the admin panel - the browser will open by itself.
echo To stop the panel, just close this window.
call npm run dev -- --open
pause
