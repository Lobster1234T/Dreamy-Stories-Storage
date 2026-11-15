@echo off
rem Double-click to let the admin website (GitHub Pages) add stories by link on this computer.
rem Keep this file ASCII-only: cmd.exe misreads non-ASCII text after chcp 65001.
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 22.18 or newer: https://nodejs.org
  pause
  exit /b 1
)
echo Dreamy Stories link helper. Keep this window open while you add stories by link on the website.
node server/helper.ts
pause
