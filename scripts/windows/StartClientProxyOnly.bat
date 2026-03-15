@echo off
setlocal
call "%~dp0RunProxyOnly.bat"
exit /b %errorlevel%
