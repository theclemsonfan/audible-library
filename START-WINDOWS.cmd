@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 24 LTS from https://nodejs.org/
  echo Then double-click this file again.
  pause
  exit /b 1
)
node scripts\start-local.mjs
pause
