$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$serverRoot = Join-Path $repoRoot "server"

$npmCommand = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npmCommand) {
  $npmCommand = (Get-Command npm -ErrorAction Stop).Source
}

Set-Location $serverRoot
& $npmCommand start
exit $LASTEXITCODE
