@echo off
rem Territory Siege: get the latest version and start the game on this computer.
cd /d "%~dp0"
title Territory Siege
if exist .git (
  where git >nul 2>nul && (
    echo Getting the latest version...
    git pull --ff-only
    echo.
  )
)
call npm install --no-audit --no-fund
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
npm start
