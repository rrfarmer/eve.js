param(
  [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $repoRoot "dist"

function Get-RelativePath {
  param(
    [string]$BasePath,
    [string]$TargetPath
  )

  $baseUri = New-Object System.Uri(($BasePath.TrimEnd("\") + "\"))
  $targetUri = New-Object System.Uri($TargetPath)
  return [System.Uri]::UnescapeDataString(
    $baseUri.MakeRelativeUri($targetUri).ToString().Replace("/", "\")
  )
}

function Test-ExcludedPath {
  param(
    [string]$RelativePath
  )

  $normalized = $RelativePath.Replace("/", "\")
  $excludedPrefixes = @(
    ".git\",
    "node_modules\",
    "client\",
    "docs\",
    "server\logs\",
    "data\fuzzwork\",
    "_secondary\",
    "_local\",
    "dist\"
  )

  foreach ($prefix in $excludedPrefixes) {
    if ($normalized.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }
  }

  $excludedFiles = @(
    "evejs.config.local.json"
  )

  foreach ($fileName in $excludedFiles) {
    if ($normalized.Equals($fileName, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }
  }

  $leafName = Split-Path -Leaf $normalized
  $excludedLeafPatterns = @(
    "tmp_*",
    "chat_client_*",
    "*.pyc",
    "*.pyj",
    "*.decomp",
    "*.decomp.py",
    "*.log"
  )

  foreach ($pattern in $excludedLeafPatterns) {
    if ($leafName -like $pattern) {
      return $true
    }
  }

  return $false
}

if (-not $OutputPath) {
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $OutputPath = Join-Path $distDir "EvEJS-source-$timestamp.zip"
}

$resolvedOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$outputDir = Split-Path -Parent $resolvedOutputPath

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("evejs-source-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null

try {
  $files = Get-ChildItem -Path $repoRoot -Recurse -File
  foreach ($file in $files) {
    $relativePath = Get-RelativePath -BasePath $repoRoot -TargetPath $file.FullName
    if (Test-ExcludedPath -RelativePath $relativePath) {
      continue
    }

    $destinationPath = Join-Path $stagingRoot $relativePath
    $destinationDir = Split-Path -Parent $destinationPath
    if (-not (Test-Path $destinationDir)) {
      New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
    }

    Copy-Item -Path $file.FullName -Destination $destinationPath -Force
  }

  if (Test-Path $resolvedOutputPath) {
    Remove-Item -Path $resolvedOutputPath -Force
  }

  Compress-Archive -Path (Join-Path $stagingRoot "*") -DestinationPath $resolvedOutputPath -CompressionLevel Optimal
  Write-Host "[eve.js] Source zip created: $resolvedOutputPath" -ForegroundColor Green
} finally {
  if (Test-Path $stagingRoot) {
    Remove-Item -Path $stagingRoot -Recurse -Force
  }
}
