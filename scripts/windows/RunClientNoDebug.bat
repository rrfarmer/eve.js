@echo off
setlocal
set "EVEJS_DEBUG_CONSOLE=0"
call "%~dp0RunClientProxy.bat"
exit /b %errorlevel%
