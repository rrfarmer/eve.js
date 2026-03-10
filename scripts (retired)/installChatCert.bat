@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ClientPath="
set "SkipRootStore=0"
set "SkipClientBundles=0"

:parse_args
if "%~1"=="" goto args_done

if /I "%~1"=="--SkipRootStore" (
    set "SkipRootStore=1"
    shift
    goto parse_args
)

if /I "%~1"=="--SkipClientBundles" (
    set "SkipClientBundles=1"
    shift
    goto parse_args
)

if not defined ClientPath (
    set "ClientPath=%~1"
)

shift
goto parse_args

:args_done
set "ScriptDir=%~dp0"
for %%I in ("%ScriptDir%..") do set "RepoRoot=%%~fI"
set "CaCertPath=%RepoRoot%\server\certs\xmpp-ca-cert.pem"

call :WriteStep Starting

if not exist "%CaCertPath%" (
    echo Missing chat CA certificate at "%CaCertPath%"
    exit /b 1
)

if "%SkipRootStore%"=="0" (
    call :EnsureRootTrust "%CaCertPath%"
    if errorlevel 1 exit /b 1
)

if "%SkipClientBundles%"=="0" (
    set "ResolvedClientPath="

    if defined ClientPath (
        for %%I in ("%ClientPath%") do set "ResolvedClientPath=%%~fI"
        if not exist "!ResolvedClientPath!" (
            echo Client path does not exist: "!ResolvedClientPath!"
            exit /b 1
        )
    )

    if defined ResolvedClientPath (
        call :ProcessBundle "!ResolvedClientPath!\bin64\cacert.pem"
        call :ProcessBundle "!ResolvedClientPath!\bin64\packages\certifi\cacert.pem"
        call :ProcessBundle "!ResolvedClientPath!\bin\cacert.pem"
        call :ProcessBundle "!ResolvedClientPath!\bin\packages\certifi\cacert.pem"
    )
)

call :WriteStep Done.
exit /b 0

:WriteStep
echo [eve.js] %~1
exit /b 0

:EnsureRootTrust
set "PemPath=%~1"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$cert = Get-PfxCertificate -FilePath '%PemPath%'; $store = Get-Item 'Cert:\CurrentUser\Root'; $existing = $store.Certificates | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }; if ($existing) { exit 10 } else { Import-Certificate -FilePath '%PemPath%' -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null; exit 0 }"

set "psExit=%errorlevel%"

if "%psExit%"=="10" (
    call :WriteStep Chat CA already trusted in CurrentUser\Root.
    exit /b 0
)

if "%psExit%"=="0" (
    call :WriteStep Installed chat CA into CurrentUser\Root.
    exit /b 0
)

echo Failed to install/check root certificate.
exit /b 1

:ProcessBundle
set "BundlePath=%~1"

if exist "%BundlePath%" (
    call :EnsurePemBundleContainsCa "%BundlePath%" "%CaCertPath%"
    if errorlevel 1 exit /b 1
)

exit /b 0

:EnsurePemBundleContainsCa
set "BundlePath=%~1"
set "PemPath=%~2"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$bundlePath = '%BundlePath%'; $pemPath = '%PemPath%'; $bundleRaw = Get-Content -Path $bundlePath -Raw; $caRaw = (Get-Content -Path $pemPath -Raw).Trim(); if ($bundleRaw.Contains($caRaw)) { exit 10 }; $updated = $bundleRaw.TrimEnd() + [Environment]::NewLine + [Environment]::NewLine + $caRaw + [Environment]::NewLine; $utf8NoBom = New-Object System.Text.UTF8Encoding($false); [System.IO.File]::WriteAllText($bundlePath, $updated, $utf8NoBom); exit 0"

set "psExit=%errorlevel%"

if "%psExit%"=="10" (
    call :WriteStep Chat CA already present in %BundlePath%
    exit /b 0
)

if "%psExit%"=="0" (
    call :WriteStep Appended chat CA to %BundlePath%
    exit /b 0
)

echo Failed updating bundle: %BundlePath%
exit /b 1