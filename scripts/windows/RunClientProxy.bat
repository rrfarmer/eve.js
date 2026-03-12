@echo off
setlocal

call "%~dp0EvEJSConfig.bat"

set "EVEJS_PROXY_LOCAL_INTERCEPT=1"
set "CLIENT_EXE="

if defined EVEJS_CLIENT_EXE if exist "%EVEJS_CLIENT_EXE%" (
  set "CLIENT_EXE=%EVEJS_CLIENT_EXE%"
)
if not defined CLIENT_EXE if defined EVEJS_CLIENT_PATH if exist "%EVEJS_CLIENT_PATH%\bin64\exefile.exe" (
  set "CLIENT_EXE=%EVEJS_CLIENT_PATH%\bin64\exefile.exe"
)
if not defined CLIENT_EXE if defined EVEJS_CLIENT_PATH if exist "%EVEJS_CLIENT_PATH%\bin\exefile.exe" (
  set "CLIENT_EXE=%EVEJS_CLIENT_PATH%\bin\exefile.exe"
)

if not defined CLIENT_EXE (
  echo [eve.js] Missing client executable path.
  echo [eve.js] Edit scripts\windows\EvEJSConfig.bat and set EVEJS_CLIENT_PATH or EVEJS_CLIENT_EXE.
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
for %%I in ("%CLIENT_DIR%..") do set "CLIENT_ROOT=%%~fI"

if not exist "%EVEJS_CA_PEM%" (
  echo [eve.js] Missing CA file: "%EVEJS_CA_PEM%"
  echo [eve.js] Run scripts\windows\InstallCerts.bat after fixing scripts\windows\EvEJSConfig.bat.
  pause
  exit /b 1
)

set "SSL_CERT_FILE=%EVEJS_CA_PEM%"
set "GRPC_DEFAULT_SSL_ROOTS_FILE_PATH=%EVEJS_CA_PEM%"
set "REQUESTS_CA_BUNDLE=%EVEJS_CA_PEM%"
set "http_proxy=%EVEJS_PROXY_URL%"
set "https_proxy=%EVEJS_PROXY_URL%"
set "HTTP_PROXY=%EVEJS_PROXY_URL%"
set "HTTPS_PROXY=%EVEJS_PROXY_URL%"
set "no_proxy=127.0.0.1,localhost,::1"
set "NO_PROXY=127.0.0.1,localhost,::1"

cd /d "%CLIENT_DIR%"
if /I "%EVEJS_DEBUG_CONSOLE%"=="1" (
  echo [eve.js] Launching client with debug console:
  echo [eve.js]   %CLIENT_EXE% /console
) else (
  echo [eve.js] Launching client:
  echo [eve.js]   %CLIENT_EXE%
)
echo [eve.js]   HTTP proxy %EVEJS_PROXY_URL%
echo [eve.js]   Client root %CLIENT_ROOT%
echo [eve.js]   CA bundle %SSL_CERT_FILE%
echo.

if /I "%EVEJS_DEBUG_CONSOLE%"=="1" (
  "%CLIENT_EXE%" /console
) else (
  "%CLIENT_EXE%"
)

set "EVEJS_EXIT=%errorlevel%"
echo.
echo [eve.js] Client exited with code %EVEJS_EXIT%.
pause
exit /b %EVEJS_EXIT%
