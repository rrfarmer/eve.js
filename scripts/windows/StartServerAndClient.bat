@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\Start-EvEJS.ps1" %*
exit /b %errorlevel%
