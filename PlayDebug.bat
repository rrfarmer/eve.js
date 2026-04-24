@echo off
setlocal EnableDelayedExpansion
title EveJS Elysian - Play (Debug Console)

rem Resolve the launcher root from this script's location.
for %%I in ("%~dp0.") do set "EVEJS_REPO_ROOT=%%~fI"

rem Load config from the new location first, then older layouts.
call :ResolveConfigDir
if errorlevel 1 exit /b 1
call "%EVEJS_CONFIG_DIR%\EvEJSConfig.bat"
if errorlevel 1 (
  echo.
  echo   [ERROR] Could not load launcher config:
  echo       %EVEJS_CONFIG_DIR%\EvEJSConfig.bat
  pause
  exit /b 1
)

echo.
echo   ============================================================
echo     EveJS Elysian - Play (Debug Console)
echo   ============================================================
echo.

set "NEEDS_SETUP=0"

if not defined EVEJS_CLIENT_PATH (
  set "NEEDS_SETUP=1"
) else if not exist "%EVEJS_CLIENT_PATH%" (
  set "NEEDS_SETUP=1"
)

if not exist "%EVEJS_CA_PEM%" set "NEEDS_SETUP=1"

set "CLIENT_EXE="
if defined EVEJS_CLIENT_EXE if exist "%EVEJS_CLIENT_EXE%" set "CLIENT_EXE=%EVEJS_CLIENT_EXE%"
if not defined CLIENT_EXE if defined EVEJS_CLIENT_PATH if exist "%EVEJS_CLIENT_PATH%\bin64\exefile.exe" set "CLIENT_EXE=%EVEJS_CLIENT_PATH%\bin64\exefile.exe"
if not defined CLIENT_EXE if defined EVEJS_CLIENT_PATH if exist "%EVEJS_CLIENT_PATH%\bin\exefile.exe" set "CLIENT_EXE=%EVEJS_CLIENT_PATH%\bin\exefile.exe"
if not defined CLIENT_EXE set "NEEDS_SETUP=1"

if "%NEEDS_SETUP%"=="1" (
  echo   [ERROR] First-time setup required.
  if exist "%EVEJS_REPO_ROOT%\tools\ClientSETUP\StartClientSetup.bat" (
    echo       Run tools\ClientSETUP\StartClientSetup.bat first.
  ) else (
    echo       Run the Client Setup launcher that came with this copy first.
  )
  pause
  exit /b 1
)

if not exist "%CLIENT_EXE%" (
  echo   [ERROR] Client executable not found: %CLIENT_EXE%
  echo       Run the setup wizard again or edit %EVEJS_CONFIG_DIR%\EvEJSConfig.bat
  pause
  exit /b 1
)

if not exist "%EVEJS_CA_PEM%" (
  echo   [ERROR] Certificate missing: %EVEJS_CA_PEM%
  pause
  exit /b 1
)

for %%I in ("%CLIENT_EXE%") do set "CLIENT_DIR=%%~dpI"
for %%I in ("%CLIENT_DIR%..") do set "CLIENT_ROOT=%%~fI"

call "%EVEJS_REPO_ROOT%\scripts\windows\ApplyClientNetworkPolicy.bat" "%EVEJS_PROXY_URL%"
if errorlevel 1 (
  echo   [ERROR] Could not apply client network policy.
  pause
  exit /b 1
)

echo   Launching EVE client with debug console...
echo.
echo     Client: %CLIENT_EXE% /console
echo     Proxy:  %EVEJS_PROXY_URL%
echo     CA cert: %EVEJS_CA_PEM%
echo.
echo   ============================================================
echo     Game is running (debug console enabled).
echo   ============================================================
echo.

cd /d "%CLIENT_DIR%"
"%CLIENT_EXE%" /console
set "EVEJS_EXIT=%errorlevel%"

echo.
if "%EVEJS_EXIT%"=="0" (
  echo   Client exited cleanly.
) else (
  echo   Client exited with code %EVEJS_EXIT%.
)

timeout /t 3 >nul
exit /b %EVEJS_EXIT%

:ResolveConfigDir
set "EVEJS_CONFIG_DIR="
if exist "%EVEJS_REPO_ROOT%\tools\ClientSETUP\scripts\EvEJSConfig.bat" (
  set "EVEJS_CONFIG_DIR=%EVEJS_REPO_ROOT%\tools\ClientSETUP\scripts"
  exit /b 0
)
if exist "%EVEJS_REPO_ROOT%\scripts\windows\EvEJSConfig.bat" (
  set "EVEJS_CONFIG_DIR=%EVEJS_REPO_ROOT%\scripts\windows"
  exit /b 0
)
if exist "%~dp0scripts\EvEJSConfig.bat" (
  set "EVEJS_CONFIG_DIR=%~dp0scripts"
  exit /b 0
)
if exist "%~dp0scripts\windows\EvEJSConfig.bat" (
  set "EVEJS_CONFIG_DIR=%~dp0scripts\windows"
  exit /b 0
)
if exist "%~dp0EvEJSConfig.bat" (
  set "EVEJS_CONFIG_DIR=%~dp0"
  exit /b 0
)
echo.
echo   [ERROR] Launcher config was not found.
echo       Looked for EvEJSConfig.bat under:
echo       %EVEJS_REPO_ROOT%\tools\ClientSETUP\scripts
echo       %EVEJS_REPO_ROOT%\scripts\windows
echo       %~dp0scripts
echo.
echo       Update your launcher files or run the Client Setup wizard again.
pause
exit /b 1
