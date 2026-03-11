@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..") do set "REPO_ROOT=%%~fI"
set "CLIENT_EXE="

if not "%~1"=="" (
  set "CLIENT_EXE=%~1"
)
if not defined CLIENT_EXE if defined EVEJS_CLIENT_EXE if exist "%EVEJS_CLIENT_EXE%" (
  set "CLIENT_EXE=%EVEJS_CLIENT_EXE%"
)
if not defined CLIENT_EXE if defined EVEJS_CLIENT_PATH if exist "%EVEJS_CLIENT_PATH%\bin64\exefile.exe" (
  set "CLIENT_EXE=%EVEJS_CLIENT_PATH%\bin64\exefile.exe"
)
if not defined CLIENT_EXE if defined EVEJS_CLIENT_PATH if exist "%EVEJS_CLIENT_PATH%\bin\exefile.exe" (
  set "CLIENT_EXE=%EVEJS_CLIENT_PATH%\bin\exefile.exe"
)
if not defined CLIENT_EXE if exist "%REPO_ROOT%\client\EVE\tq\bin64\exefile.exe" (
  set "CLIENT_EXE=%REPO_ROOT%\client\EVE\tq\bin64\exefile.exe"
)
if not defined CLIENT_EXE if exist "%REPO_ROOT%\client\EVE\tq\bin\exefile.exe" (
  set "CLIENT_EXE=%REPO_ROOT%\client\EVE\tq\bin\exefile.exe"
)

if not defined CLIENT_EXE (
  echo [eve.js] Missing client executable path.
  echo [eve.js] Checked EVEJS_CLIENT_EXE, EVEJS_CLIENT_PATH, and repo client copy under "%REPO_ROOT%\client\EVE\tq".
  pause
  exit /b 1
)

if not exist "%CLIENT_EXE%" (
  echo [eve.js] Client executable does not exist: "%CLIENT_EXE%"
  pause
  exit /b 1
)

set "CLIENT_DIR=%~dp1"
if "%CLIENT_DIR%"=="" set "CLIENT_DIR=%~dp0"
for %%I in ("%CLIENT_EXE%") do set "CLIENT_DIR=%%~dpI"
set "EVEJS_PROXY=http://localhost:26002"

set "http_proxy=%EVEJS_PROXY%"
set "https_proxy=%EVEJS_PROXY%"
set "HTTP_PROXY=%EVEJS_PROXY%"
set "HTTPS_PROXY=%EVEJS_PROXY%"
set "no_proxy=127.0.0.1,localhost,::1"
set "NO_PROXY=127.0.0.1,localhost,::1"

cd /d "%CLIENT_DIR%"
echo [eve.js] Launching client with debug console:
echo [eve.js]   %CLIENT_EXE% /console
echo [eve.js]   HTTP proxy %EVEJS_PROXY%
echo.
"%CLIENT_EXE%" /console
set "EVEJS_EXIT=%errorlevel%"
echo.
echo [eve.js] Debug client exited with code %EVEJS_EXIT%.
pause
exit /b %EVEJS_EXIT%
