@echo off
rem Territory Siege: get the latest version and start the game on this computer.
cd /d "%~dp0"
title Territory Siege
rem Update first, then start this file again fresh (the update may have changed it).
if not "%TS_UPDATED%"=="1" (
  call update.bat
  set TS_UPDATED=1
  call "%~f0"
  exit /b
)
rem Stop a game server left running from last time (it would keep the old version on port 3000).
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":3000 .*LISTENING"') do taskkill /f /pid %%p >nul 2>nul
call npm install --no-audit --no-fund
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
npm start
