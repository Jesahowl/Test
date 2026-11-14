@echo off
rem Territory Siege: fetch the latest version of the game. play.bat and play-online.bat run this
rem first; you can also double-click it on its own.
rem It runs from a copy in %TEMP%: updating rewrites this very file, and Windows reads a .bat
rem file line by line while running it.
if "%~1"=="" (
  copy /y "%~f0" "%TEMP%\ts-update.bat" >nul
  call "%TEMP%\ts-update.bat" "%~dp0."
  exit /b
)
setlocal
cd /d "%~1"
set BRANCH=claude/determined-johnson-hion2w

if not exist .git (
  echo [!] This folder wasn't downloaded with Git, so it can't update itself.
  echo     See "Updating automatically" in README.md to set that up.
  echo.
  goto :done
)
where git >nul 2>nul
if errorlevel 1 (
  echo [!] Git isn't installed, so the game can't update.
  echo     Install it once with:  winget install --id Git.Git   then open this file again.
  echo.
  goto :done
)

for /f "delims=" %%v in ('git log -1 --format^="%%h %%cr"') do set OLD=%%v
echo Getting the latest version...
rem npm install sometimes rewrites package-lock.json; that change would block the update.
git checkout -- package-lock.json >nul 2>nul
git fetch origin %BRANCH%
if errorlevel 1 (
  echo [!] Couldn't reach GitHub: is the internet working? Starting the version you have.
  echo.
  goto :done
)
rem Move to the newest version of the game branch (also fixes a folder that's on another branch).
git checkout -B %BRANCH% origin/%BRANCH%
if errorlevel 1 (
  echo.
  echo [!] The update was blocked by files changed in this folder (listed above^).
  echo     To throw those changes away and update, run:  git reset --hard origin/%BRANCH%
  echo.
  pause
  goto :done
)
for /f "delims=" %%v in ('git log -1 --format^="%%h %%cr"') do set NEW=%%v
echo.
echo Was:  %OLD%
echo Now:  %NEW%
git log -1 --format="      %%s"
echo.

:done
endlocal
