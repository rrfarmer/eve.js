@echo off
setlocal EnableExtensions EnableDelayedExpansion

call "%~dp0EvEJSConfig.bat"

set "TRACE_SCRIPT=%EVEJS_REPO_ROOT%\scripts\internal\warp_native_trace.py"
if not exist "%TRACE_SCRIPT%" (
  echo [eve.js] Missing warp trace script: "%TRACE_SCRIPT%"
  pause
  exit /b 1
)

set "TRACE_LAUNCHER="
where python >nul 2>&1 && set "TRACE_LAUNCHER=python"
if not defined TRACE_LAUNCHER (
  where py >nul 2>&1 && set "TRACE_LAUNCHER=py -3"
)

if not defined TRACE_LAUNCHER (
  echo [eve.js] Python launcher not found.
  echo [eve.js] Install Python or add python.exe / py.exe to PATH.
  pause
  exit /b 1
)

set "TRACE_PROCESS=exefile.exe"
if defined EVEJS_WARP_TRACE_PROCESS set "TRACE_PROCESS=%EVEJS_WARP_TRACE_PROCESS%"

set "TRACE_ARGS=--process ""%TRACE_PROCESS%"""
if defined EVEJS_WARP_TRACE_SHIP_ID set "TRACE_ARGS=!TRACE_ARGS! --ship-id %EVEJS_WARP_TRACE_SHIP_ID%"
if defined EVEJS_WARP_TRACE_OUTPUT set "TRACE_ARGS=!TRACE_ARGS! --output ""%EVEJS_WARP_TRACE_OUTPUT%"""
if defined EVEJS_WARP_TRACE_WAIT_SECONDS set "TRACE_ARGS=!TRACE_ARGS! --wait-seconds %EVEJS_WARP_TRACE_WAIT_SECONDS%"
if defined EVEJS_WARP_TRACE_DURATION_SECONDS set "TRACE_ARGS=!TRACE_ARGS! --duration-seconds %EVEJS_WARP_TRACE_DURATION_SECONDS%"

echo [eve.js] Starting warp native trace terminal:
echo [eve.js]   !TRACE_LAUNCHER! "%TRACE_SCRIPT%" !TRACE_ARGS!
start "EvEJS Warp Native Trace" cmd /k !TRACE_LAUNCHER! "%TRACE_SCRIPT%" !TRACE_ARGS!

set "EVEJS_DEBUG_CONSOLE=1"
call "%~dp0RunClientProxy.bat"
exit /b %errorlevel%
