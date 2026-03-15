@echo off
setlocal
call "%~dp0RunClientNoDebug.bat"
exit /b %errorlevel%
