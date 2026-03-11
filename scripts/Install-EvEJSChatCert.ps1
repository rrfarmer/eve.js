param(
  [string]$ClientPath,
  [switch]$SkipRootStore,
  [switch]$SkipClientBundles
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$caCertPath = Join-Path $repoRoot "server\certs\xmpp-ca-cert.pem"

function Write-Step {
  param([string]$Message)

  Write-Host "[eve.js] $Message" -ForegroundColor Cyan
}

function Get-ClientBundlePaths {
  param([string]$ResolvedClientPath)

  if (-not $ResolvedClientPath) {
    return @()
  }

  return @(
    (Join-Path $ResolvedClientPath "bin64\cacert.pem"),
    (Join-Path $ResolvedClientPath "bin64\packages\certifi\cacert.pem"),
    (Join-Path $ResolvedClientPath "bin\cacert.pem"),
    (Join-Path $ResolvedClientPath "bin\packages\certifi\cacert.pem")
  ) | Where-Object { Test-Path $_ }
}

function Ensure-RootTrust {
  param([string]$PemPath)

  $cert = Get-PfxCertificate -FilePath $PemPath
  $existing = Get-ChildItem Cert:\CurrentUser\Root | Where-Object {
    $_.Thumbprint -eq $cert.Thumbprint
  }

  if ($existing) {
    Write-Step "Chat CA already trusted in CurrentUser\\Root."
    return
  }

  Import-Certificate -FilePath $PemPath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
  Write-Step "Installed chat CA into CurrentUser\\Root."
}

function Ensure-PemBundleContainsCa {
  param(
    [string]$BundlePath,
    [string]$PemPath
  )

  $bundleRaw = Get-Content -Path $BundlePath -Raw
  $caRaw = (Get-Content -Path $PemPath -Raw).Trim()

  if ($bundleRaw.Contains($caRaw)) {
    Write-Step "Chat CA already present in $BundlePath"
    return
  }

  $updated = $bundleRaw.TrimEnd() + "`r`n`r`n" + $caRaw + "`r`n"
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($BundlePath, $updated, $encoding)
  Write-Step "Appended chat CA to $BundlePath"
}

if (-not (Test-Path $caCertPath)) {
  throw "Missing chat CA certificate at $caCertPath"
}

if (-not $SkipRootStore) {
  Ensure-RootTrust -PemPath $caCertPath
}

if (-not $SkipClientBundles) {
  $resolvedClientPath = $null
  if ($ClientPath) {
    $resolvedClientPath = (Resolve-Path -Path $ClientPath).Path
  }

  foreach ($bundlePath in Get-ClientBundlePaths -ResolvedClientPath $resolvedClientPath) {
    Ensure-PemBundleContainsCa -BundlePath $bundlePath -PemPath $caCertPath
  }
}
