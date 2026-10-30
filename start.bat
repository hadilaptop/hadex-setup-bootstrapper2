@echo off
setlocal
cd /d "%~dp0"
npm start
if errorlevel 1 (
  echo.
  echo Hadex Browser failed to start.
  pause
)
endlocal
