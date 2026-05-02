@echo off
setlocal
pushd "%~dp0"
if not exist "seed_universe_sites.js" (
  echo [!] seed_universe_sites.js is missing from this folder.
  pause
  exit /b 1
)
universe-site-seed.exe
set "EXIT_CODE=%errorlevel%"
popd
exit /b %EXIT_CODE%
