@echo off
setlocal

call "%~dp0EvEJSConfig.bat"

set "EVEJS_PROXY_LOCAL_INTERCEPT=1"
pushd "%EVEJS_REPO_ROOT%"
echo [eve.js] Starting server only from "%EVEJS_REPO_ROOT%\server"
call npm --prefix server start
set "EVEJS_EXIT=%errorlevel%"
popd

if not "%EVEJS_EXIT%"=="0" (
  echo [eve.js] Server exited with code %EVEJS_EXIT%.
  pause
)

exit /b %EVEJS_EXIT%
