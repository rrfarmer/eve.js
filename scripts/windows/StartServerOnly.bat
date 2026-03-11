@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\Start-EvEJS.ps1" -SkipClient %*
exit /b %errorlevel%
