@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
set "start_exit=%errorlevel%"
echo.
pause
exit /b %start_exit%
