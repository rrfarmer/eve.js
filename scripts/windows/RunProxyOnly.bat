@echo off
setlocal

call "%~dp0EvEJSConfig.bat"

set "EVEJS_EXPRESS_PROXY_ENABLED=1"
set "EVEJS_PROXY_LOCAL_INTERCEPT=1"
pushd "%EVEJS_REPO_ROOT%\server"
echo [eve.js] Starting local proxy only from "%EVEJS_REPO_ROOT%\server"
call node proxy-only.js
set "EVEJS_EXIT=%errorlevel%"
popd

if not "%EVEJS_EXIT%"=="0" (
  echo [eve.js] Proxy exited with code %EVEJS_EXIT%.
  pause
)

exit /b %EVEJS_EXIT%
