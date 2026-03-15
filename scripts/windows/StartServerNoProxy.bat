@echo off
setlocal

call "%~dp0EvEJSConfig.bat"

rem Force server-only behavior even if local config enables autoLaunch.
set "EVEJS_AUTO_LAUNCH=0"
rem Leave the client proxy redirect to a separate StartClientProxyOnly.bat terminal.
set "EVEJS_EXPRESS_PROXY_ENABLED=0"
set "EVEJS_PROXY_LOCAL_INTERCEPT=1"
pushd "%EVEJS_REPO_ROOT%\server"
echo [eve.js] Starting server without local proxy from "%EVEJS_REPO_ROOT%\server"
call node .
set "EVEJS_EXIT=%errorlevel%"
popd

if not "%EVEJS_EXIT%"=="0" (
  echo [eve.js] Server exited with code %EVEJS_EXIT%.
  pause
)

exit /b %EVEJS_EXIT%
