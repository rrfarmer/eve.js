param(
  [string]$DumpDate
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$dumpIndexUrl = "https://www.fuzzwork.co.uk/dump/"
$latestBaseUrl = "https://www.fuzzwork.co.uk/dump/latest"
$archiveBaseUrl = "https://www.fuzzwork.co.uk/dump"
$generatedShipDataPath = Join-Path $repoRoot "server\src\database\static\shipTypes.json"

function Write-Step {
  param([string]$Message)

  Write-Host "[eve.js] $Message" -ForegroundColor Cyan
}

function Get-LatestDumpDate {
  $response = Invoke-WebRequest -Uri $dumpIndexUrl -UseBasicParsing
  $match = [regex]::Match(
    $response.Content,
    'mysql-latest\.tar\.bz2[\s\S]*?([0-9]{4}-[0-9]{2}-[0-9]{2})',
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )

  if (-not $match.Success) {
    throw "Could not determine latest Fuzzwork dump date from $dumpIndexUrl"
  }

  return $match.Groups[1].Value
}

if (-not $DumpDate) {
  $DumpDate = Get-LatestDumpDate
}

$workspaceDumpDir = Join-Path $repoRoot ("data\fuzzwork\" + $DumpDate)
$rawDir = Join-Path $workspaceDumpDir "raw"
$archivePath = Join-Path $workspaceDumpDir "mysql-latest.tar.bz2"
$invTypesPath = Join-Path $rawDir "invTypes-nodescription.csv"
$invGroupsPath = Join-Path $rawDir "invGroups.csv"

New-Item -ItemType Directory -Force -Path $workspaceDumpDir, $rawDir | Out-Null

Write-Step "Downloading latest Fuzzwork ship source files for dump $DumpDate"
Invoke-WebRequest -Uri "$archiveBaseUrl/mysql-latest.tar.bz2" -OutFile $archivePath
Invoke-WebRequest -Uri "$latestBaseUrl/invTypes-nodescription.csv" -OutFile $invTypesPath
Invoke-WebRequest -Uri "$latestBaseUrl/invGroups.csv" -OutFile $invGroupsPath

Write-Step "Generating workspace ship index"
Push-Location $repoRoot
try {
  node .\scripts\build-ship-data.js `
    --invTypes $invTypesPath `
    --invGroups $invGroupsPath `
    --output $generatedShipDataPath `
    --dump-date $DumpDate

  if ($LASTEXITCODE -ne 0) {
    throw "Ship data generation failed."
  }
} finally {
  Pop-Location
}

Write-Step "Ship data is ready at $generatedShipDataPath"
