param(
  [string]$ClientPath,
  [switch]$SkipClient,
  [switch]$ClientOnly,
  [switch]$ForceInstall
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$rootPackageDir = $repoRoot
$serverDir = Join-Path $repoRoot "server"
$localConfigPath = Join-Path $repoRoot "evejs.config.local.json"
$exampleConfigPath = Join-Path $repoRoot "evejs.config.example.json"
$patchedDllPath = Join-Path $repoRoot "PATCHED_FILES\blue.dll"
$serverBootstrapPath = Join-Path $PSScriptRoot "Run-EvEJSServer.ps1"
$chatCertInstallerPath = Join-Path $PSScriptRoot "Install-EvEJSChatCert.ps1"

function Write-Step {
  param([string]$Message)

  Write-Host "[eve.js] $Message" -ForegroundColor Cyan
}

function Get-NpmCommand {
  $npmCommand = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
  if (-not $npmCommand) {
    $npmCommand = (Get-Command npm -ErrorAction Stop).Source
  }

  return $npmCommand
}

function Read-JsonFile {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return $null
  }

  $raw = Get-Content -Path $Path -Raw
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return $null
  }

  $raw = $raw.TrimStart([char]0xFEFF)
  return $raw | ConvertFrom-Json
}

function Get-ObjectValue {
  param(
    [object]$Object,
    [string]$Name,
    $Default = $null
  )

  if ($null -eq $Object) {
    return $Default
  }

  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) {
    return $Default
  }

  if ($property.Value -is [string] -and [string]::IsNullOrWhiteSpace($property.Value)) {
    return $Default
  }

  return $property.Value
}

function Write-JsonFile {
  param(
    [string]$Path,
    [hashtable]$Value
  )

  $json = $Value | ConvertTo-Json -Depth 10
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $json, $encoding)
}

function Ensure-LocalConfig {
  $exampleConfig = Read-JsonFile -Path $exampleConfigPath

  $localConfig = [ordered]@{
    clientPath = [string](Get-ObjectValue -Object $exampleConfig -Name "clientPath" -Default "")
    autoLaunch = [bool](Get-ObjectValue -Object $exampleConfig -Name "autoLaunch" -Default $true)
    devMode = [bool](Get-ObjectValue -Object $exampleConfig -Name "devMode" -Default $true)
    logLevel = [int](Get-ObjectValue -Object $exampleConfig -Name "logLevel" -Default 2)
    serverPort = [int](Get-ObjectValue -Object $exampleConfig -Name "serverPort" -Default 26000)
  }

  $existingConfig = Read-JsonFile -Path $localConfigPath
  if ($null -ne $existingConfig) {
    foreach ($key in @("clientPath", "autoLaunch", "devMode", "logLevel", "serverPort")) {
      $value = Get-ObjectValue -Object $existingConfig -Name $key
      if ($null -ne $value -and -not ($value -is [string] -and [string]::IsNullOrWhiteSpace($value))) {
        $localConfig[$key] = $value
      }
    }
  } else {
    Write-Step "Creating evejs.config.local.json with launcher defaults."
  }

  if ($ClientPath) {
    $resolvedClientPath = (Resolve-Path -Path $ClientPath).Path
    $localConfig.clientPath = $resolvedClientPath
  }

  Write-JsonFile -Path $localConfigPath -Value $localConfig
  return Read-JsonFile -Path $localConfigPath
}

function Ensure-Dependencies {
  param(
    [string]$PackageDir,
    [string]$Label
  )

  $nodeModulesPath = Join-Path $PackageDir "node_modules"
  if (-not $ForceInstall -and (Test-Path $nodeModulesPath)) {
    return
  }

  $npmCommand = Get-NpmCommand
  Write-Step "Installing $Label dependencies."

  Push-Location $PackageDir
  try {
    if (Test-Path (Join-Path $PackageDir "package-lock.json")) {
      & $npmCommand ci
    } else {
      & $npmCommand install
    }

    if ($LASTEXITCODE -ne 0) {
      throw "npm install failed in $PackageDir"
    }
  } finally {
    Pop-Location
  }
}

function Find-EveClientPath {
  $searchRoots = @(
    (Join-Path $env:USERPROFILE "Documents"),
    (Join-Path $env:USERPROFILE "Downloads"),
    (Join-Path $env:USERPROFILE "Desktop"),
    (Join-Path $env:LOCALAPPDATA "CCP\EVE"),
    (Join-Path $env:ProgramFiles "CCP\EVE"),
    (Join-Path ${env:ProgramFiles(x86)} "CCP\EVE")
  ) | Where-Object { $_ -and (Test-Path $_) }

  foreach ($root in $searchRoots) {
    $matches = Get-ChildItem -Path $root -Filter "start.ini" -File -Recurse -Depth 5 -ErrorAction SilentlyContinue
    foreach ($match in $matches) {
      $candidate = $match.DirectoryName
      if ((Test-Path (Join-Path $candidate "bin64\exefile.exe")) -or
          (Test-Path (Join-Path $candidate "bin\exefile.exe"))) {
        return $candidate
      }
    }
  }

  return $null
}

function Resolve-ClientExecutable {
  param([string]$ConfiguredClientPath)

  if (-not $ConfiguredClientPath) {
    return $null
  }

  $candidates = @(
    (Join-Path $ConfiguredClientPath "bin64\exefile.exe"),
    (Join-Path $ConfiguredClientPath "bin\exefile.exe"),
    (Join-Path $ConfiguredClientPath "exefile.exe")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return $null
}

function Update-StartIni {
  param(
    [string]$StartIniPath,
    [int]$Port
  )

  $lines = Get-Content -Path $StartIniPath
  $updatedLines = New-Object System.Collections.Generic.List[string]
  $hasServerLine = $false
  $hasPortLine = $false

  foreach ($line in $lines) {
    $updatedLine = $line

    if ($updatedLine -match '^\s*server\s*=') {
      $updatedLine = "server=127.0.0.1"
      $hasServerLine = $true
    } elseif ($updatedLine -match '^\s*port\s*=') {
      $updatedLine = "port=$Port"
      $hasPortLine = $true
    } else {
      $updatedLine = $updatedLine -replace "CryptoAPI", "Placebo"
      $updatedLine = $updatedLine -replace "Tranquility", "localhost"
    }

    $updatedLines.Add($updatedLine)
  }

  if (-not $hasServerLine) {
    $updatedLines.Add("server=127.0.0.1")
  }

  if (-not $hasPortLine) {
    $updatedLines.Add("port=$Port")
  }

  Set-Content -Path $StartIniPath -Value $updatedLines -Encoding ASCII
}

function Patch-ClientFiles {
  param(
    [string]$ConfiguredClientPath,
    [int]$Port
  )

  if (-not (Test-Path $ConfiguredClientPath)) {
    throw "Configured client path does not exist: $ConfiguredClientPath"
  }

  $clientExecutable = Resolve-ClientExecutable -ConfiguredClientPath $ConfiguredClientPath
  if (-not $clientExecutable) {
    throw "Could not find exefile.exe under $ConfiguredClientPath"
  }

  $clientBinDir = Split-Path -Parent $clientExecutable
  $startIniPath = Join-Path $ConfiguredClientPath "start.ini"

  if (-not (Test-Path $startIniPath)) {
    throw "Could not find start.ini under $ConfiguredClientPath"
  }

  if (-not (Test-Path $patchedDllPath)) {
    throw "Missing patched blue.dll at $patchedDllPath"
  }

  # Copy-Item -Path $patchedDllPath -Destination (Join-Path $clientBinDir "blue.dll") -Force
  # Update-StartIni -StartIniPath $startIniPath -Port $Port

  if (Test-Path $chatCertInstallerPath) {
    & $chatCertInstallerPath -ClientPath $ConfiguredClientPath
  }

  return $clientExecutable
}

function Test-TcpPort {
  param([int]$Port)

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(500)) {
      return $false
    }

    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Ensure-ServerRunning {
  param([int]$Port)

  if (Test-TcpPort -Port $Port) {
    Write-Step "Server port $Port is already listening."
    return
  }

  Write-Step "Starting the eve.js server."
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList @(
      "-NoExit",
      "-ExecutionPolicy", "Bypass",
      "-File", "`"$serverBootstrapPath`""
    ) `
    -WorkingDirectory $repoRoot | Out-Null

  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if (Test-TcpPort -Port $Port) {
      Write-Step "Server is listening on port $Port."
      return
    }
  }

  throw "Server did not become ready on port $Port within 30 seconds."
}

try {
  $config = Ensure-LocalConfig
  $configuredPort = [int](Get-ObjectValue -Object $config -Name "serverPort" -Default 26000)
  $configuredClientPath = [string](Get-ObjectValue -Object $config -Name "clientPath" -Default "")

  if (-not $ClientOnly) {
    Ensure-Dependencies -PackageDir $rootPackageDir -Label "root"
    Ensure-Dependencies -PackageDir $serverDir -Label "server"
    Ensure-ServerRunning -Port $configuredPort
  }

  if ($SkipClient) {
    Write-Step "Client launch skipped."
    exit 0
  }

  if (-not $configuredClientPath) {
    $detectedClientPath = Find-EveClientPath
    if ($detectedClientPath) {
      Write-Step "Detected EVE client at $detectedClientPath"
      $configToPersist = [ordered]@{
        clientPath = $detectedClientPath
        autoLaunch = [bool](Get-ObjectValue -Object $config -Name "autoLaunch" -Default $true)
        devMode = [bool](Get-ObjectValue -Object $config -Name "devMode" -Default $true)
        logLevel = [int](Get-ObjectValue -Object $config -Name "logLevel" -Default 2)
        serverPort = $configuredPort
      }
      Write-JsonFile -Path $localConfigPath -Value $configToPersist
      $configuredClientPath = $detectedClientPath
    }
  }

  if (-not $configuredClientPath) {
    if ($ClientOnly) {
      Write-Host '[eve.js] No EVE client path is configured yet. Run .\StartServerAndClient.bat -ClientPath "C:\path\to\client" once the client download finishes.' -ForegroundColor Yellow
      exit 1
    }

    Write-Step "No EVE client path configured yet. Server is ready. Re-run StartServerAndClient.bat with -ClientPath once the client download finishes."
    exit 0
  }

  $clientExecutable = Patch-ClientFiles -ConfiguredClientPath $configuredClientPath -Port $configuredPort
  Write-Step "Launching client from $clientExecutable"
  Start-Process -FilePath $clientExecutable -ArgumentList "/console" -WorkingDirectory (Split-Path -Parent $clientExecutable)
} catch {
  Write-Host "[eve.js] $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
