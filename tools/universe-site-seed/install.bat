@echo off
setlocal EnableExtensions EnableDelayedExpansion
title EvEJS Universe Seeder - Installer
color 0B

set "APP_NAME=EvEJS Universe Seeder"
set "AUTHOR=John Elysian"
set "MIN_FREE_MB=300"

call :NormalizeDir "%~dp0" PACKAGE_DIR
set "TARGET_REPO=%~1"
if /I "%TARGET_REPO%"=="--help" goto Help
if /I "%TARGET_REPO%"=="/?" goto Help

call :Header
call :Step "1" "Checking Windows"
call :CheckWindows

call :Step "2" "Checking this package"
call :CheckPackage

call :Step "3" "Finding your EvEJS folder"
call :ResolveRepo
call :CheckRepo

call :Step "4" "Checking free space"
call :CheckDiskSpace

call :Step "5" "Checking runtime tools"
call :EnsureNode
call :CheckRustBuildTools

call :Step "6" "Installing the seeder"
call :InstallFiles

call :Step "7" "Running a read-only health check"
call :RunHealthCheck

call :Step "8" "Finishing setup"
call :CreateShortcut
call :Finish
exit /b 0

:Help
echo.
echo %APP_NAME% installer
echo.
echo Usage:
echo   install.bat
echo   install.bat C:\path\to\EvEJS
echo.
exit /b 0

:Header
cls
echo.
echo  ======================================================================
echo    %APP_NAME%
echo    Installer
echo  ----------------------------------------------------------------------
echo    Designed by %AUTHOR%
echo    A guided setup for persistent EvEJS universe site data.
echo  ======================================================================
echo.
exit /b 0

:Step
echo.
echo  [%~1] %~2
echo  ----------------------------------------------------------------------
exit /b 0

:Pass
echo    [OK] %~1
if not "%~2"=="" echo         %~2
exit /b 0

:Info
echo    [..] %~1
if not "%~2"=="" echo         %~2
exit /b 0

:Warn
echo    [!!] %~1
if not "%~2"=="" echo         %~2
exit /b 0

:Fail
echo.
echo    [!] %~1
if not "%~2"=="" echo        %~2
echo.
echo  Setup stopped before making unsafe changes.
echo.
pause
exit /b 1

:NormalizeDir
for %%I in ("%~1.") do set "%~2=%%~fI"
exit /b 0

:CheckWindows
if /I not "%OS%"=="Windows_NT" call :Fail "This installer is for Windows 10/11."
set "ARCH=%PROCESSOR_ARCHITECTURE%"
if /I "%PROCESSOR_ARCHITEW6432%"=="AMD64" set "ARCH=AMD64"
if /I not "%ARCH%"=="AMD64" call :Fail "This package is built for 64-bit Windows." "Detected: %ARCH%"
where powershell >nul 2>nul
if errorlevel 1 call :Fail "PowerShell is required for setup checks."
where robocopy >nul 2>nul
if errorlevel 1 call :Fail "Robocopy is required for safe folder copying."
call :Pass "Windows 64-bit is ready" "%OS% / %ARCH%"
exit /b 0

:CheckPackage
if not exist "%PACKAGE_DIR%\universe-site-seed.exe" call :Fail "universe-site-seed.exe is missing." "Extract the zip first, then run install.bat again."
if not exist "%PACKAGE_DIR%\seed_universe_sites.js" call :Fail "seed_universe_sites.js is missing." "Extract the zip first, then run install.bat again."
if not exist "%PACKAGE_DIR%\RunUniverseSiteSeeder.bat" call :Fail "RunUniverseSiteSeeder.bat is missing." "Extract the zip first, then run install.bat again."
if not exist "%PACKAGE_DIR%\data\spec\dungeonSpawnProfiles.json" call :Fail "Bundled seeder data is missing." "Extract the full zip, including the data folder."
call :Pass "Package files are present" "%PACKAGE_DIR%"
exit /b 0

:ResolveRepo
if defined TARGET_REPO (
  set "TARGET_REPO=%TARGET_REPO:"=%"
  for %%I in ("%TARGET_REPO%") do set "TARGET_REPO=%%~fI"
  if exist "%TARGET_REPO%\server\src\newDatabase\data\dungeonAuthority\data.json" (
    call :Pass "EvEJS folder supplied" "%TARGET_REPO%"
    exit /b 0
  )
  call :Warn "The supplied folder is not an EvEJS checkout." "%TARGET_REPO%"
  set "TARGET_REPO="
)

call :FindRepo "%CD%"
if defined TARGET_REPO (
  call :Pass "EvEJS folder found" "%TARGET_REPO%"
  exit /b 0
)

call :FindRepo "%PACKAGE_DIR%"
if defined TARGET_REPO (
  call :Pass "EvEJS folder found" "%TARGET_REPO%"
  exit /b 0
)

:AskRepo
echo.
echo    Paste the folder that contains your EvEJS checkout.
echo    Example: C:\Users\John\Documents\Testing\EvEJS
echo.
set /p "TARGET_REPO=   EvEJS folder: "
if not defined TARGET_REPO call :Fail "No EvEJS folder was entered."
set "TARGET_REPO=%TARGET_REPO:"=%"
for %%I in ("%TARGET_REPO%") do set "TARGET_REPO=%%~fI"
if not exist "%TARGET_REPO%\server\src\newDatabase\data\dungeonAuthority\data.json" (
  call :Warn "That folder does not look like EvEJS." "%TARGET_REPO%"
  set "TARGET_REPO="
  goto AskRepo
)
call :Pass "EvEJS folder selected" "%TARGET_REPO%"
exit /b 0

:FindRepo
set "SCAN=%~f1"
:FindRepoLoop
if exist "%SCAN%\server\src\newDatabase\data\dungeonAuthority\data.json" (
  set "TARGET_REPO=%SCAN%"
  exit /b 0
)
for %%I in ("%SCAN%\..") do set "PARENT=%%~fI"
if /I "%PARENT%"=="%SCAN%" exit /b 1
set "SCAN=%PARENT%"
goto FindRepoLoop

:CheckRepo
if not exist "%TARGET_REPO%\server\src\newDatabase\data\dungeonAuthority\data.json" call :Fail "Missing dungeon authority data." "%TARGET_REPO%"
if not exist "%TARGET_REPO%\server\src\newDatabase\data\dungeonRuntimeState\data.json" call :Fail "Missing dungeon runtime state data." "%TARGET_REPO%"
if not exist "%TARGET_REPO%\server\src\newDatabase\data\miningRuntimeState\data.json" call :Fail "Missing mining runtime state data." "%TARGET_REPO%"
call :Pass "EvEJS data tables are present" "server\src\newDatabase\data"
exit /b 0

:CheckDiskSpace
set "DISK_FILE=%TEMP%\evejs-seeder-disk-%RANDOM%.txt"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=[IO.Path]::GetPathRoot($env:TARGET_REPO); $drive=Get-PSDrive -Name $root.Substring(0,1); if ($drive.Free -lt %MIN_FREE_MB%MB) { 'Only {0:N0} MB free' -f ($drive.Free/1MB); exit 1 }; '{0:N0} MB free' -f ($drive.Free/1MB)" > "%DISK_FILE%"
set "DISK_EXIT=%errorlevel%"
set "DISK_RESULT=unknown"
if exist "%DISK_FILE%" set /p DISK_RESULT=<"%DISK_FILE%"
del "%DISK_FILE%" >nul 2>nul
if not "%DISK_EXIT%"=="0" call :Fail "Not enough free disk space." "%DISK_RESULT%"
call :Pass "Disk space looks good" "%DISK_RESULT%"
exit /b 0

:EnsureNode
where node >nul 2>nul
if errorlevel 1 call :InstallNode "Node.js LTS is required to run the seeder engine."

set "NODE_VERSION="
for /f "delims=" %%N in ('node -v 2^>nul') do set "NODE_VERSION=%%N"
if not defined NODE_VERSION call :InstallNode "Node.js was found, but it did not respond correctly."

powershell -NoProfile -ExecutionPolicy Bypass -Command "$major=[int]((node -v).TrimStart('v').Split('.')[0]); if ($major -lt 18) { exit 1 }" >nul 2>nul
if errorlevel 1 call :InstallNode "Node.js %NODE_VERSION% is old. Node.js 18 LTS or newer is recommended."

set "NODE_VERSION="
for /f "delims=" %%N in ('node -v 2^>nul') do set "NODE_VERSION=%%N"
call :Pass "Node.js is ready" "%NODE_VERSION%"
exit /b 0

:InstallNode
call :Warn "%~1"
if defined SEEDER_INSTALL_SILENT call :Fail "Node.js is missing and silent install is enabled."
where winget >nul 2>nul
if errorlevel 1 call :Fail "Node.js is missing and winget is not available." "Install Node.js LTS, then run this installer again."
echo.
choice /C YN /M "   Install Node.js LTS with winget now"
if errorlevel 2 call :Fail "Node.js is required before this tool can run."
echo.
echo    Installing Node.js LTS. Windows may ask for permission.
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
if errorlevel 1 call :Fail "Node.js installation did not complete."
set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 call :Fail "Node.js installed, but this terminal cannot see it yet." "Close this window and run install.bat again."
exit /b 0

:CheckRustBuildTools
if not exist "%PACKAGE_DIR%\Cargo.toml" (
  where cargo >nul 2>nul
  if errorlevel 1 (
    call :Info "Rust build tools are not required" "This release package already includes the compiled app."
  ) else (
    for /f "delims=" %%R in ('rustc --version 2^>nul') do call :Pass "Rust toolchain detected" "%%R"
  )
  exit /b 0
)

call :Info "Source install detected" "Checking Rust and MSVC build tools."
where cargo >nul 2>nul
if errorlevel 1 call :InstallRust
for /f "delims=" %%R in ('rustc --version 2^>nul') do set "RUST_VERSION=%%R"
if not defined RUST_VERSION call :Fail "Rust is installed, but rustc is not available."
call :Pass "Rust toolchain is ready" "%RUST_VERSION%"
call :CheckMsvcLinker
exit /b 0

:InstallRust
if defined SEEDER_INSTALL_SILENT call :Fail "Rust is missing and silent install is enabled."
where winget >nul 2>nul
if errorlevel 1 call :Fail "Rust is missing and winget is not available." "Install Rustup, then run this installer again."
echo.
choice /C YN /M "   Install Rustup with winget now"
if errorlevel 2 call :Fail "Rust is required for source builds."
winget install -e --id Rustlang.Rustup --accept-package-agreements --accept-source-agreements
if errorlevel 1 call :Fail "Rustup installation did not complete."
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
exit /b 0

:CheckMsvcLinker
where link.exe >nul 2>nul
if not errorlevel 1 (
  call :Pass "MSVC linker is ready" "link.exe"
  exit /b 0
)
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "MSVC_LINK="
if exist "%VSWHERE%" (
  for /f "delims=" %%L in ('"%VSWHERE%" -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find "VC\Tools\MSVC\**\bin\Hostx64\x64\link.exe" 2^>nul') do set "MSVC_LINK=%%L"
)
if defined MSVC_LINK (
  call :Pass "MSVC linker is installed" "%MSVC_LINK%"
  exit /b 0
)
call :Warn "MSVC build tools were not found." "Rust source builds can fail with linker errors without them."
if defined SEEDER_INSTALL_SILENT call :Fail "MSVC build tools are missing and silent install is enabled."
where winget >nul 2>nul
if errorlevel 1 call :Fail "Install Visual Studio Build Tools with the C++ workload, then run this again."
echo.
choice /C YN /M "   Install Visual Studio 2022 Build Tools now"
if errorlevel 2 call :Fail "MSVC build tools are required for source builds."
winget install -e --id Microsoft.VisualStudio.2022.BuildTools --accept-package-agreements --accept-source-agreements --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
if errorlevel 1 call :Fail "Visual Studio Build Tools installation did not complete."
exit /b 0

:InstallFiles
set "DEST=%TARGET_REPO%\tools\universe-site-seed"
for %%I in ("%DEST%") do set "DEST=%%~fI"
if not exist "%TARGET_REPO%\tools" mkdir "%TARGET_REPO%\tools"
if /I "%PACKAGE_DIR%"=="%DEST%" (
  call :Info "Package is already in the target folder" "%DEST%"
  exit /b 0
)
if not exist "%DEST%" mkdir "%DEST%"
robocopy "%PACKAGE_DIR%" "%DEST%" /E /XD dist target .git /XF last-run.log last-crash.log smoke-out.log smoke-err.log >nul
set "ROBO_EXIT=%errorlevel%"
if %ROBO_EXIT% GEQ 8 call :Fail "Copy failed." "Robocopy exit code %ROBO_EXIT%"
call :Pass "Files installed" "%DEST%"
exit /b 0

:RunHealthCheck
pushd "%TARGET_REPO%"
node "%DEST%\seed_universe_sites.js" --inspect --force-live > "%DEST%\install-health-check.log" 2>&1
set "HEALTH_EXIT=%errorlevel%"
popd
if not "%HEALTH_EXIT%"=="0" call :Fail "Read-only health check failed." "Open %DEST%\install-health-check.log"
call :Pass "Read-only health check passed" "%DEST%\install-health-check.log"
exit /b 0

:CreateShortcut
if defined SEEDER_INSTALL_SILENT (
  call :Info "Desktop shortcut skipped" "Silent install mode."
  exit /b 0
)
echo.
choice /C YN /M "   Create a desktop shortcut"
if errorlevel 2 (
  call :Info "Desktop shortcut skipped"
  exit /b 0
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$shell=New-Object -ComObject WScript.Shell; $path=[IO.Path]::Combine([Environment]::GetFolderPath('Desktop'),'EvEJS Universe Seeder.lnk'); $shortcut=$shell.CreateShortcut($path); $shortcut.TargetPath=[IO.Path]::Combine($env:DEST,'RunUniverseSiteSeeder.bat'); $shortcut.WorkingDirectory=$env:DEST; $shortcut.Description='EvEJS Universe Seeder by John Elysian'; $shortcut.Save()"
if errorlevel 1 call :Warn "Desktop shortcut could not be created."
if not errorlevel 1 call :Pass "Desktop shortcut created" "EvEJS Universe Seeder"
exit /b 0

:Finish
echo.
echo  ======================================================================
echo    Install complete
echo  ----------------------------------------------------------------------
echo    Installed to:
echo      %DEST%
echo.
echo    Launch with:
echo      %DEST%\RunUniverseSiteSeeder.bat
echo.
echo    Designed by %AUTHOR%.
echo  ======================================================================
echo.
if defined SEEDER_INSTALL_SILENT exit /b 0
choice /C YN /M "   Open the seeder now"
if errorlevel 2 (
  echo.
  echo    Done. You can close this window.
  pause
  exit /b 0
)
start "" "%DEST%\RunUniverseSiteSeeder.bat"
exit /b 0
