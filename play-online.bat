@echo off
rem Territory Siege: get the latest version, start the game and share it online with a Cloudflare link.
rem Double-click this file. Close the windows (or press Ctrl+C in them) to stop.
cd /d "%~dp0"
title Territory Siege (online)

rem Update first, then start this file again fresh (the update may have changed it).
if not "%TS_UPDATED%"=="1" (
  call update.bat
  set TS_UPDATED=1
  call "%~f0"
  exit /b
)
rem Stop a game server left running from last time (it would keep the old version on port 3000).
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":3000 .*LISTENING"') do taskkill /f /pid %%p >nul 2>nul

echo Installing...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo npm failed: is Node.js installed?  https://nodejs.org
  pause
  exit /b 1
)

echo Starting the game...
start "Territory Siege server" cmd /k npm start
timeout /t 3 /nobreak >nul

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo.
  echo The game is running at http://localhost:3000
  echo To share it online, install Cloudflare's tunnel once:  winget install --id Cloudflare.cloudflared
  echo then run this file again.
  pause
  exit /b 0
)

echo.
echo ================================================================
echo  Your public link appears below: the line with  .trycloudflare.com
echo  Send it to your friends. You can play at http://localhost:3000
echo ================================================================
echo.
cloudflared tunnel --url http://localhost:3000
