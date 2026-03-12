@echo off
setlocal
set "EVEJS_DEBUG_CONSOLE=1"
call "%~dp0RunClientProxy.bat"
exit /b %errorlevel%
