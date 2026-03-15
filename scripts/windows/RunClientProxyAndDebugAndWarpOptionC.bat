@echo off
setlocal EnableExtensions EnableDelayedExpansion

call "%~dp0EvEJSConfig.bat"

set "PATCH_SCRIPT=%EVEJS_REPO_ROOT%\scripts\internal\warp_option_c_patch.py"
if not exist "%PATCH_SCRIPT%" (
  echo [eve.js] Missing Option C patch script: "%PATCH_SCRIPT%"
  pause
  exit /b 1
)

set "PATCH_LAUNCHER="
where python >nul 2>&1 && set "PATCH_LAUNCHER=python"
if not defined PATCH_LAUNCHER (
  where py >nul 2>&1 && set "PATCH_LAUNCHER=py -3"
)

if not defined PATCH_LAUNCHER (
  echo [eve.js] Python launcher not found.
  echo [eve.js] Install Python or add python.exe / py.exe to PATH.
  pause
  exit /b 1
)

set "PATCH_PROCESS=exefile.exe"
if defined EVEJS_WARP_OPTION_C_PROCESS set "PATCH_PROCESS=%EVEJS_WARP_OPTION_C_PROCESS%"

set "PATCH_ARGS=--process ""%PATCH_PROCESS%"""
if defined EVEJS_WARP_OPTION_C_OUTPUT set "PATCH_ARGS=!PATCH_ARGS! --output ""%EVEJS_WARP_OPTION_C_OUTPUT%"""
if not defined EVEJS_WARP_OPTION_C_OUTPUT set "PATCH_ARGS=!PATCH_ARGS! --output ""%EVEJS_REPO_ROOT%\server\logs\warp-option-c-patch.jsonl"""
if defined EVEJS_WARP_OPTION_C_WAIT_SECONDS set "PATCH_ARGS=!PATCH_ARGS! --wait-seconds %EVEJS_WARP_OPTION_C_WAIT_SECONDS%"
if not defined EVEJS_WARP_OPTION_C_WAIT_SECONDS set "PATCH_ARGS=!PATCH_ARGS! --wait-seconds 120"
if defined EVEJS_WARP_OPTION_C_DURATION_SECONDS set "PATCH_ARGS=!PATCH_ARGS! --duration-seconds %EVEJS_WARP_OPTION_C_DURATION_SECONDS%"
if not defined EVEJS_WARP_OPTION_C_DURATION_SECONDS set "PATCH_ARGS=!PATCH_ARGS! --duration-seconds 0"

echo [eve.js] Starting Option C patch terminal:
echo [eve.js]   !PATCH_LAUNCHER! "%PATCH_SCRIPT%" !PATCH_ARGS!
start "EvEJS Warp Option C Patch" cmd /k !PATCH_LAUNCHER! "%PATCH_SCRIPT%" !PATCH_ARGS!

set "EVEJS_DEBUG_CONSOLE=1"
call "%~dp0RunClientProxy.bat"
exit /b %errorlevel%
