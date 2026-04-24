Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:ClientSetupDir = Split-Path -Parent $PSCommandPath
$script:DefaultManifestPath = Join-Path $script:ClientSetupDir "blue-dll.patch.json"

class PatchError : System.Exception {
    PatchError([string]$Message) : base($Message) {}
}

class PatchValidationError : PatchError {
    PatchValidationError([string]$Message) : base($Message) {}
}

class AlreadyPatchedError : PatchValidationError {
    AlreadyPatchedError([string]$Message) : base($Message) {}
}

function Convert-HexToBytes {
    param([string]$Hex)

    if ([string]::IsNullOrWhiteSpace($Hex)) {
        return ,([byte[]]::new(0))
    }

    if (($Hex.Length % 2) -ne 0) {
        throw [PatchError]::new("Invalid hex string length.")
    }

    $bytes = [byte[]]::new($Hex.Length / 2)
    for ($i = 0; $i -lt $bytes.Length; $i++) {
        $bytes[$i] = [Convert]::ToByte($Hex.Substring($i * 2, 2), 16)
    }
    return ,$bytes
}

function Compare-ByteArrays {
    param(
        [byte[]]$Left,
        [byte[]]$Right
    )

    if ($null -eq $Left -or $null -eq $Right) {
        return $false
    }

    if ($Left.Length -ne $Right.Length) {
        return $false
    }

    for ($i = 0; $i -lt $Left.Length; $i++) {
        if ($Left[$i] -ne $Right[$i]) {
            return $false
        }
    }

    return $true
}

function Get-ByteSlice {
    param(
        [byte[]]$Bytes,
        [int]$Offset,
        [int]$Count
    )

    if ($Count -le 0) {
        return ,([byte[]]::new(0))
    }

    $slice = [byte[]]::new($Count)
    [System.Array]::Copy($Bytes, $Offset, $slice, 0, $Count)
    return ,$slice
}

function Get-Sha256Hex {
    param([byte[]]$Bytes)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Get-FileSha256Hex {
    param([string]$Path)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    } finally {
        $stream.Dispose()
        $sha.Dispose()
    }
}

function Read-FileBytes {
    param([string]$Path)

    try {
        return ,([System.IO.File]::ReadAllBytes($Path))
    } catch {
        throw [PatchError]::new("Failed to read ${Path}: $($_.Exception.Message)")
    }
}

function Resolve-AbsolutePath {
    param([string]$Path)

    return [System.IO.Path]::GetFullPath($Path)
}

function Load-BlueDllPatchManifest {
    param(
        [string]$ManifestPath = $script:DefaultManifestPath
    )

    $manifestFullPath = Resolve-AbsolutePath $ManifestPath
    if (-not (Test-Path -LiteralPath $manifestFullPath)) {
        throw [PatchError]::new("Patch manifest not found: $manifestFullPath")
    }

    $raw = Get-Content -LiteralPath $manifestFullPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $patches = @()
    foreach ($patch in @($raw.patches)) {
        $allowMismatchedBefore = $false
        if ($patch.PSObject.Properties.Match("allowMismatchedBefore").Count -gt 0) {
            $allowMismatchedBefore = [bool]$patch.allowMismatchedBefore
        }
        $patches += [pscustomobject]@{
            Offset                = [int]$patch.offset
            OffsetHex             = [string]$patch.offsetHex
            Description           = [string]$patch.description
            Before                = [byte[]](Convert-HexToBytes ([string]$patch.beforeHex))
            After                 = [byte[]](Convert-HexToBytes ([string]$patch.afterHex))
            AllowMismatchedBefore = $allowMismatchedBefore
        }
    }

    $overlay = $null
    if ($raw.overlay) {
        $allowMismatchedBeforeSha256 = $false
        if ($raw.overlay.PSObject.Properties.Match("allowMismatchedBeforeSha256").Count -gt 0) {
            $allowMismatchedBeforeSha256 = [bool]$raw.overlay.allowMismatchedBeforeSha256
        }
        $overlay = [pscustomobject]@{
            Offset                      = [int]$raw.overlay.offset
            OffsetHex                   = [string]$raw.overlay.offsetHex
            Description                 = [string]$raw.overlay.description
            BeforeSize                  = [int]$raw.overlay.beforeSize
            AfterSize                   = [int]$raw.overlay.afterSize
            BeforeSha256                = [string]$raw.overlay.beforeSha256
            AfterSha256                 = [string]$raw.overlay.afterSha256
            Compression                 = [string]$raw.overlay.compression
            DataBase64                  = [string]$raw.overlay.dataBase64
            AllowMismatchedBeforeSha256 = $allowMismatchedBeforeSha256
        }
    }

    return [pscustomobject]@{
        Name        = [string]$raw.name
        Description = [string]$raw.description
        Source      = [pscustomobject]@{
            Filename = [string]$raw.source.filename
            Size     = [int64]$raw.source.size
            Sha256   = ([string]$raw.source.sha256).ToLowerInvariant()
        }
        Target      = [pscustomobject]@{
            Filename = [string]$raw.target.filename
            Size     = [int64]$raw.target.size
            Sha256   = ([string]$raw.target.sha256).ToLowerInvariant()
        }
        Patches     = $patches
        Overlay     = $overlay
        Path        = $manifestFullPath
    }
}

function Expand-OverlayBytes {
    param([object]$Overlay)

    if ([string]::Compare($Overlay.Compression, "deflate", $true) -ne 0) {
        throw [PatchError]::new("Unsupported overlay compression: $($Overlay.Compression)")
    }

    try {
        $compressedBytes = [Convert]::FromBase64String($Overlay.DataBase64)
    } catch {
        throw [PatchError]::new("Failed to decode the overlay payload from the patch manifest.")
    }

    if ($compressedBytes.Length -le 2) {
        throw [PatchError]::new("Overlay payload is unexpectedly short.")
    }

    $deflateBytes = Get-ByteSlice -Bytes $compressedBytes -Offset 2 -Count ($compressedBytes.Length - 2)
    $input = New-Object System.IO.MemoryStream
    $output = New-Object System.IO.MemoryStream
    try {
        $input.Write($deflateBytes, 0, $deflateBytes.Length)
        $input.Position = 0
        $stream = New-Object System.IO.Compression.DeflateStream($input, [System.IO.Compression.CompressionMode]::Decompress)
        try {
            $stream.CopyTo($output)
        } catch {
            throw [PatchError]::new("Failed to decode the overlay payload from the patch manifest.")
        } finally {
            $stream.Dispose()
        }

        $inflated = $output.ToArray()
    } finally {
        $output.Dispose()
        $input.Dispose()
    }

    if ($inflated.Length -ne $Overlay.AfterSize) {
        throw [PatchError]::new("Overlay size mismatch after decode. Expected $($Overlay.AfterSize), got $($inflated.Length).")
    }

    if ((Get-Sha256Hex $inflated) -ne $Overlay.AfterSha256.ToLowerInvariant()) {
        throw [PatchError]::new("Decoded overlay SHA-256 does not match the patch manifest.")
    }

    return ,$inflated
}

function Apply-BlueDllPatchBytes {
    param(
        [byte[]]$SourceBytes,
        [object]$Manifest,
        [switch]$AllowRelaxedVariant
    )

    $sourceHash = Get-Sha256Hex $SourceBytes
    $isExactSource = ($SourceBytes.Length -eq $Manifest.Source.Size -and $sourceHash -eq $Manifest.Source.Sha256)
    $hasSupportedEnvelopeSize = ($SourceBytes.Length -eq $Manifest.Source.Size -or $SourceBytes.Length -eq $Manifest.Target.Size)

    if ($SourceBytes.Length -eq $Manifest.Target.Size -and $sourceHash -eq $Manifest.Target.Sha256) {
        throw [AlreadyPatchedError]::new("This blue.dll is already patched.")
    }

    if (-not $hasSupportedEnvelopeSize) {
        throw [PatchValidationError]::new("This blue.dll does not match the supported original or compatible variant sizes and will not be patched.")
    }

    if (-not $isExactSource -and -not $AllowRelaxedVariant.IsPresent) {
        throw [PatchValidationError]::new("This blue.dll does not match the exact supported original build and will not be patched.")
    }

    $patched = [byte[]]::new($SourceBytes.Length)
    [System.Array]::Copy($SourceBytes, $patched, $SourceBytes.Length)

    foreach ($patch in $Manifest.Patches) {
        $current = Get-ByteSlice -Bytes $patched -Offset $patch.Offset -Count $patch.Before.Length
        $matchesBefore = Compare-ByteArrays -Left $current -Right $patch.Before
        $matchesAfter = Compare-ByteArrays -Left $current -Right $patch.After

        if ($matchesAfter) {
            continue
        }

        if ((-not $matchesBefore) -and -not $patch.AllowMismatchedBefore) {
            $currentHex = ([System.BitConverter]::ToString($current)).Replace("-", "").ToLowerInvariant()
            $expectedHex = ([System.BitConverter]::ToString($patch.Before)).Replace("-", "").ToLowerInvariant()
            throw [PatchValidationError]::new("Unexpected bytes at $($patch.OffsetHex). Expected $expectedHex, got $currentHex.")
        }

        [System.Array]::Copy($patch.After, 0, $patched, $patch.Offset, $patch.After.Length)
    }

    $finalBytes = $patched
    if ($Manifest.Overlay) {
        $overlay = $Manifest.Overlay
        $sourceOverlay = Get-ByteSlice -Bytes $SourceBytes -Offset $overlay.Offset -Count ($SourceBytes.Length - $overlay.Offset)

        if ($sourceOverlay.Length -ne $overlay.BeforeSize -and $sourceOverlay.Length -ne $overlay.AfterSize) {
            throw [PatchValidationError]::new("Unexpected source overlay size. Expected $($overlay.BeforeSize) or $($overlay.AfterSize), got $($sourceOverlay.Length).")
        }

        $sourceOverlaySha = Get-Sha256Hex $sourceOverlay
        $overlayMatchesKnownBefore = ($sourceOverlay.Length -eq $overlay.BeforeSize -and $sourceOverlaySha -eq $overlay.BeforeSha256.ToLowerInvariant())
        $overlayMatchesKnownAfter = ($sourceOverlay.Length -eq $overlay.AfterSize -and $sourceOverlaySha -eq $overlay.AfterSha256.ToLowerInvariant())

        if (-not $overlayMatchesKnownBefore -and -not $overlayMatchesKnownAfter -and -not $overlay.AllowMismatchedBeforeSha256) {
            throw [PatchValidationError]::new("Source overlay SHA-256 does not match the manifest.")
        }

        $patchedOverlay = Expand-OverlayBytes -Overlay $overlay
        $finalBytes = [byte[]]::new($overlay.Offset + $patchedOverlay.Length)
        [System.Array]::Copy($patched, 0, $finalBytes, 0, $overlay.Offset)
        [System.Array]::Copy($patchedOverlay, 0, $finalBytes, $overlay.Offset, $patchedOverlay.Length)
    }

    if ($finalBytes.Length -ne $Manifest.Target.Size) {
        throw [PatchError]::new("Patched output size mismatch. Expected $($Manifest.Target.Size), got $($finalBytes.Length).")
    }

    $finalHash = Get-Sha256Hex $finalBytes
    if ($finalHash -ne $Manifest.Target.Sha256) {
        throw [PatchError]::new("Patched output SHA-256 does not match the target manifest hash.")
    }

    return ,$finalBytes
}

function Get-BlueDllInspection {
    param(
        [string]$Path,
        [object]$Manifest
    )

    $candidate = Resolve-AbsolutePath $Path
    if (-not (Test-Path -LiteralPath $candidate)) {
        return [pscustomobject]@{
            Path     = $candidate
            Exists   = $false
            Size     = $null
            Sha256   = $null
            State    = "missing"
            Summary  = "File not found."
            Action   = "Choose a blue.dll from the EVE client's bin64 folder."
            CanPatch = $false
        }
    }

    $item = Get-Item -LiteralPath $candidate
    if ($item.PSIsContainer) {
        return [pscustomobject]@{
            Path     = $candidate
            Exists   = $false
            Size     = $null
            Sha256   = $null
            State    = "missing"
            Summary  = "That path is not a file."
            Action   = "Choose the actual blue.dll file, not a folder."
            CanPatch = $false
        }
    }

    $size = [int64]$item.Length
    $hash = Get-FileSha256Hex $candidate

    if ($size -eq $Manifest.Target.Size -and $hash -eq $Manifest.Target.Sha256) {
        return [pscustomobject]@{
            Path     = $candidate
            Exists   = $true
            Size     = $size
            Sha256   = $hash
            State    = "already_patched"
            Summary  = "This file already matches the EvEJS patched blue.dll."
            Action   = "No patch is needed."
            CanPatch = $false
        }
    }

    if ($size -eq $Manifest.Source.Size -and $hash -eq $Manifest.Source.Sha256) {
        return [pscustomobject]@{
            Path     = $candidate
            Exists   = $true
            Size     = $size
            Sha256   = $hash
            State    = "patchable_original"
            Summary  = "Exact original build detected. Safe to patch."
            Action   = "Ready to patch to the EvEJS version."
            CanPatch = $true
        }
    }

    if ($size -eq $Manifest.Source.Size -or $size -eq $Manifest.Target.Size) {
        try {
            $sourceBytes = Read-FileBytes $candidate
            [void](Apply-BlueDllPatchBytes -SourceBytes $sourceBytes -Manifest $Manifest -AllowRelaxedVariant)
            return [pscustomobject]@{
                Path     = $candidate
                Exists   = $true
                Size     = $size
                Sha256   = $hash
                State    = "patchable_variant"
                Summary  = "This blue.dll differs from the recorded source hash, but a relaxed dry run still reaches the exact EvEJS patched target."
                Action   = "Use Attempt Patch Anyway to patch and verify against the known-good target hash."
                CanPatch = $true
            }
        } catch [PatchError] {
        }
    }

    if ($size -eq $Manifest.Source.Size) {
        $summary = "This looks like an unpatched blue.dll, but not the exact supported build."
    } elseif ($size -eq $Manifest.Target.Size) {
        $summary = "This looks close to the patched size, but it is not the EvEJS target build."
    } else {
        $summary = "This file does not match the supported original or patched blue.dll sizes."
    }

    return [pscustomobject]@{
        Path     = $candidate
        Exists   = $true
        Size     = $size
        Sha256   = $hash
        State    = "unknown"
        Summary  = $summary
        Action   = "Do not patch this file unless you add a manifest for its exact build."
        CanPatch = $false
    }
}

function Get-DefaultOutputPath {
    param([string]$InputPath)

    $dir = Split-Path -Parent $InputPath
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($InputPath)
    $ext = [System.IO.Path]::GetExtension($InputPath)
    return Join-Path $dir ("{0}.patched{1}" -f $stem, $ext)
}

function Write-AtomicFile {
    param(
        [string]$Path,
        [byte[]]$Data
    )

    $fullPath = Resolve-AbsolutePath $Path
    $directory = Split-Path -Parent $fullPath
    if (-not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    $tempPath = Join-Path $directory ([System.IO.Path]::GetRandomFileName())
    try {
        [System.IO.File]::WriteAllBytes($tempPath, $Data)
        Move-Item -LiteralPath $tempPath -Destination $fullPath -Force
    } finally {
        if (Test-Path -LiteralPath $tempPath) {
            Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Apply-BlueDllPatch {
    param(
        [string]$InputPath,
        [string]$OutputPath,
        [switch]$InPlace,
        [string]$BackupSuffix = ".original",
        [object]$Manifest,
        [switch]$Force,
        [switch]$AllowRelaxedVariant
    )

    $candidate = Resolve-AbsolutePath $InputPath
    $inspection = Get-BlueDllInspection -Path $candidate -Manifest $Manifest

    if ($inspection.State -eq "already_patched") {
        throw [AlreadyPatchedError]::new("This blue.dll already matches the EvEJS patched build.")
    }

    if (-not $inspection.CanPatch) {
        throw [PatchValidationError]::new($inspection.Summary)
    }

    if ($inspection.State -eq "patchable_variant" -and -not $AllowRelaxedVariant.IsPresent) {
        throw [PatchValidationError]::new("This blue.dll needs Attempt Patch Anyway because its source hash differs from the recorded build.")
    }

    $sourceBytes = Read-FileBytes $candidate
    $patchedBytes = Apply-BlueDllPatchBytes -SourceBytes $sourceBytes -Manifest $Manifest -AllowRelaxedVariant:$AllowRelaxedVariant

    $resolvedOutput = $null
    $backupPath = $null
    $backupCreated = $false

    if ($InPlace.IsPresent) {
        $resolvedOutput = $candidate
        $backupPath = "$candidate$BackupSuffix"
        if (-not (Test-Path -LiteralPath $backupPath)) {
            Copy-Item -LiteralPath $candidate -Destination $backupPath
            $backupCreated = $true
        }
    } else {
        $resolvedOutput = if ([string]::IsNullOrWhiteSpace($OutputPath)) { Get-DefaultOutputPath $candidate } else { Resolve-AbsolutePath $OutputPath }
        if ($resolvedOutput -eq $candidate) {
            throw [PatchValidationError]::new("Output path matches the input path. Use --in-place to patch the file directly.")
        }
        if ((Test-Path -LiteralPath $resolvedOutput) -and -not $Force.IsPresent) {
            throw [PatchValidationError]::new("Output file already exists: $resolvedOutput. Choose another path or enable overwrite.")
        }
    }

    Write-AtomicFile -Path $resolvedOutput -Data $patchedBytes

    return [pscustomobject]@{
        InputPath             = $candidate
        OutputPath            = $resolvedOutput
        BackupPath            = $backupPath
        BackupCreated         = $backupCreated
        Sha256                = Get-Sha256Hex $patchedBytes
        Size                  = [int64]$patchedBytes.Length
        UsedRelaxedValidation = $AllowRelaxedVariant.IsPresent
    }
}

function Format-BlueDllInspection {
    param([object]$Inspection)

    $lines = @(
        "Path:    $($Inspection.Path)"
        "State:   $($Inspection.State)"
        "Summary: $($Inspection.Summary)"
        "Action:  $($Inspection.Action)"
    )
    if ($null -ne $Inspection.Size) {
        $lines += "Size:    $($Inspection.Size)"
    }
    if ($null -ne $Inspection.Sha256) {
        $lines += "SHA-256: $($Inspection.Sha256)"
    }
    return $lines -join [Environment]::NewLine
}

function Format-BlueDllPatchResult {
    param([object]$Result)

    $lines = @(
        "Input:   $($Result.InputPath)"
        "Output:  $($Result.OutputPath)"
        "Size:    $($Result.Size)"
        "SHA-256: $($Result.Sha256)"
    )
    if ($Result.UsedRelaxedValidation) {
        $lines += "Mode:    relaxed compatibility"
    }
    if ($Result.BackupPath) {
        $status = if ($Result.BackupCreated) { "created" } else { "already existed" }
        $lines += "Backup:  $($Result.BackupPath) ($status)"
    }
    return $lines -join [Environment]::NewLine
}

function Show-Usage {
    @"
Usage:
  blue_dll_patch.ps1 --input <path> --inspect [--manifest <path>]
  blue_dll_patch.ps1 --input <path> --in-place [--backup-suffix .original] [--manifest <path>]
  blue_dll_patch.ps1 --input <path> --output <path> [--force] [--manifest <path>]
  blue_dll_patch.ps1 --gui [--input <path>] [--manifest <path>]

Options:
  --input, --path        Path to the blue.dll to inspect or patch.
  --inspect              Inspect only; do not patch.
  --output               Path for the patched file when not patching in place.
  --in-place             Patch the selected file in place.
  --backup-suffix        Backup suffix used for --in-place. Default: .original
  --manifest             Path to the patch manifest.
  --force                Overwrite an existing output path.
  --attempt-anyway       Try a compatible hash variant and only succeed if the final output still matches the known target hash.
  --gui                  Launch the built-in Windows GUI.
  --help                 Show this help.
"@
}

function Parse-BlueDllArguments {
    param([string[]]$Arguments)

    $parsed = [ordered]@{
        Input         = $null
        Inspect       = $false
        Output        = $null
        InPlace       = $false
        BackupSuffix  = ".original"
        Manifest      = $script:DefaultManifestPath
        Force         = $false
        AttemptAnyway = $false
        Gui           = $false
        Help          = $false
    }

    $positionals = New-Object System.Collections.Generic.List[string]
    $index = 0
    while ($index -lt $Arguments.Count) {
        $token = [string]$Arguments[$index]
        switch ($token) {
            "--help" { $parsed.Help = $true }
            "-h" { $parsed.Help = $true }
            "/?" { $parsed.Help = $true }
            "--inspect" { $parsed.Inspect = $true }
            "--in-place" { $parsed.InPlace = $true }
            "--force" { $parsed.Force = $true }
            "--attempt-anyway" { $parsed.AttemptAnyway = $true }
            "--gui" { $parsed.Gui = $true }
            "--input" {
                $index++
                if ($index -ge $Arguments.Count) { throw [PatchError]::new("Missing value for --input.") }
                $parsed.Input = [string]$Arguments[$index]
            }
            "--path" {
                $index++
                if ($index -ge $Arguments.Count) { throw [PatchError]::new("Missing value for --path.") }
                $parsed.Input = [string]$Arguments[$index]
            }
            "--output" {
                $index++
                if ($index -ge $Arguments.Count) { throw [PatchError]::new("Missing value for --output.") }
                $parsed.Output = [string]$Arguments[$index]
            }
            "--backup-suffix" {
                $index++
                if ($index -ge $Arguments.Count) { throw [PatchError]::new("Missing value for --backup-suffix.") }
                $parsed.BackupSuffix = [string]$Arguments[$index]
            }
            "--manifest" {
                $index++
                if ($index -ge $Arguments.Count) { throw [PatchError]::new("Missing value for --manifest.") }
                $parsed.Manifest = [string]$Arguments[$index]
            }
            default {
                if ($token.StartsWith("-")) {
                    throw [PatchError]::new("Unknown option: $token")
                }
                $positionals.Add($token)
            }
        }
        $index++
    }

    if (-not $parsed.Input -and $positionals.Count -gt 0) {
        $parsed.Input = $positionals[0]
    }

    return [pscustomobject]$parsed
}

function Get-ConfiguredBlueDllPath {
    $configuredRoot = $env:EVEJS_CLIENT_PATH
    if (-not [string]::IsNullOrWhiteSpace($configuredRoot)) {
        return (Join-Path $configuredRoot "bin64\blue.dll")
    }

    $repoRoot = Split-Path -Parent (Split-Path -Parent $script:ClientSetupDir)
    $repoCandidate = Join-Path $repoRoot "client\EVE\tq\bin64\blue.dll"
    if (Test-Path -LiteralPath $repoCandidate) {
        return $repoCandidate
    }

    return $null
}

function Show-StartupError {
    param([string]$Message)

    try {
        Add-Type -AssemblyName System.Windows.Forms | Out-Null
        [System.Windows.Forms.MessageBox]::Show($Message, "EvEJS blue.dll Patcher", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    } catch {
        Write-Output $Message
    }
}

function Start-BlueDllPatchGui {
    param(
        [string]$InitialPath,
        [string]$ManifestPath
    )

    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    Add-Type -AssemblyName System.Drawing | Out-Null
    [System.Windows.Forms.Application]::EnableVisualStyles()

    $manifest = Load-BlueDllPatchManifest $ManifestPath
    $title = "EvEJS blue.dll Patcher"
    $stateStyles = @{
        patchable_original = @{ Text = "Ready To Patch"; Fore = [System.Drawing.Color]::FromArgb(15, 107, 67); Back = [System.Drawing.Color]::FromArgb(220, 252, 231) }
        patchable_variant  = @{ Text = "Compatible Variant"; Fore = [System.Drawing.Color]::FromArgb(15, 108, 189); Back = [System.Drawing.Color]::FromArgb(219, 234, 254) }
        already_patched    = @{ Text = "Already Patched"; Fore = [System.Drawing.Color]::FromArgb(18, 78, 140); Back = [System.Drawing.Color]::FromArgb(219, 234, 254) }
        unknown            = @{ Text = "Unsupported Build"; Fore = [System.Drawing.Color]::FromArgb(146, 64, 14); Back = [System.Drawing.Color]::FromArgb(254, 243, 199) }
        missing            = @{ Text = "File Missing"; Fore = [System.Drawing.Color]::FromArgb(75, 85, 99); Back = [System.Drawing.Color]::FromArgb(229, 231, 235) }
    }

    $form = New-Object System.Windows.Forms.Form
    $form.Text = $title
    $form.StartPosition = "CenterScreen"
    $form.Size = New-Object System.Drawing.Size(920, 700)
    $form.MinimumSize = New-Object System.Drawing.Size(920, 700)
    $form.BackColor = [System.Drawing.Color]::FromArgb(237, 244, 251)

    $titleLabel = New-Object System.Windows.Forms.Label
    $titleLabel.Text = $title
    $titleLabel.Font = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
    $titleLabel.SetBounds(20, 18, 860, 34)
    $form.Controls.Add($titleLabel)

    $subtitleLabel = New-Object System.Windows.Forms.Label
    $subtitleLabel.Text = "Safely patch an exact original blue.dll into the EvEJS build. Compatible variants only succeed if the final output still matches the known target hash."
    $subtitleLabel.Font = New-Object System.Drawing.Font("Segoe UI", 9)
    $subtitleLabel.ForeColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
    $subtitleLabel.SetBounds(20, 55, 860, 36)
    $form.Controls.Add($subtitleLabel)

    $manifestLabel = New-Object System.Windows.Forms.Label
    $manifestLabel.Text = "Manifest: $([System.IO.Path]::GetFileName($manifest.Path)) | Original SHA-256: $($manifest.Source.Sha256.Substring(0, 16))... | Patched SHA-256: $($manifest.Target.Sha256.Substring(0, 16))..."
    $manifestLabel.Font = New-Object System.Drawing.Font("Segoe UI", 8.5)
    $manifestLabel.ForeColor = [System.Drawing.Color]::FromArgb(100, 116, 139)
    $manifestLabel.SetBounds(20, 90, 860, 24)
    $form.Controls.Add($manifestLabel)

    $inputLabel = New-Object System.Windows.Forms.Label
    $inputLabel.Text = "blue.dll to inspect"
    $inputLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
    $inputLabel.SetBounds(20, 124, 200, 22)
    $form.Controls.Add($inputLabel)

    $inputBox = New-Object System.Windows.Forms.TextBox
    $inputBox.Font = New-Object System.Drawing.Font("Consolas", 10)
    $inputBox.SetBounds(20, 150, 600, 28)
    $inputBox.Anchor = "Top, Left, Right"
    $form.Controls.Add($inputBox)

    $browseButton = New-Object System.Windows.Forms.Button
    $browseButton.Text = "Browse"
    $browseButton.SetBounds(632, 148, 110, 32)
    $browseButton.Anchor = "Top, Right"
    $form.Controls.Add($browseButton)

    $configuredButton = New-Object System.Windows.Forms.Button
    $configuredButton.Text = "Use Configured Client"
    $configuredButton.SetBounds(750, 148, 130, 32)
    $configuredButton.Anchor = "Top, Right"
    $form.Controls.Add($configuredButton)

    $statusBadge = New-Object System.Windows.Forms.Label
    $statusBadge.Text = "Waiting For File"
    $statusBadge.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
    $statusBadge.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
    $statusBadge.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    $statusBadge.SetBounds(20, 195, 180, 28)
    $form.Controls.Add($statusBadge)

    $summaryLabel = New-Object System.Windows.Forms.Label
    $summaryLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
    $summaryLabel.SetBounds(20, 230, 860, 42)
    $summaryLabel.Anchor = "Top, Left, Right"
    $form.Controls.Add($summaryLabel)

    $detailBox = New-Object System.Windows.Forms.TextBox
    $detailBox.Multiline = $true
    $detailBox.ReadOnly = $true
    $detailBox.Font = New-Object System.Drawing.Font("Consolas", 10)
    $detailBox.ScrollBars = "Vertical"
    $detailBox.SetBounds(20, 275, 860, 110)
    $detailBox.Anchor = "Top, Left, Right"
    $form.Controls.Add($detailBox)

    $optionsGroup = New-Object System.Windows.Forms.GroupBox
    $optionsGroup.Text = "Patch Options"
    $optionsGroup.Font = New-Object System.Drawing.Font("Segoe UI", 9)
    $optionsGroup.SetBounds(20, 395, 860, 120)
    $optionsGroup.Anchor = "Top, Left, Right"
    $form.Controls.Add($optionsGroup)

    $inPlaceRadio = New-Object System.Windows.Forms.RadioButton
    $inPlaceRadio.Text = "Patch in place and create a backup"
    $inPlaceRadio.Checked = $true
    $inPlaceRadio.SetBounds(18, 24, 300, 24)
    $optionsGroup.Controls.Add($inPlaceRadio)

    $separateRadio = New-Object System.Windows.Forms.RadioButton
    $separateRadio.Text = "Write the patched DLL to a separate file"
    $separateRadio.SetBounds(18, 52, 300, 24)
    $optionsGroup.Controls.Add($separateRadio)

    $backupLabel = New-Object System.Windows.Forms.Label
    $backupLabel.Text = "Backup Suffix"
    $backupLabel.SetBounds(350, 25, 100, 22)
    $optionsGroup.Controls.Add($backupLabel)

    $backupBox = New-Object System.Windows.Forms.TextBox
    $backupBox.Text = ".original"
    $backupBox.SetBounds(450, 23, 110, 24)
    $optionsGroup.Controls.Add($backupBox)

    $outputBox = New-Object System.Windows.Forms.TextBox
    $outputBox.Font = New-Object System.Drawing.Font("Consolas", 9)
    $outputBox.SetBounds(350, 55, 380, 24)
    $outputBox.Anchor = "Top, Left, Right"
    $optionsGroup.Controls.Add($outputBox)

    $outputBrowseButton = New-Object System.Windows.Forms.Button
    $outputBrowseButton.Text = "Browse Output"
    $outputBrowseButton.SetBounds(740, 52, 100, 28)
    $outputBrowseButton.Anchor = "Top, Right"
    $optionsGroup.Controls.Add($outputBrowseButton)

    $refreshButton = New-Object System.Windows.Forms.Button
    $refreshButton.Text = "Refresh"
    $refreshButton.SetBounds(660, 525, 100, 36)
    $refreshButton.Anchor = "Top, Right"
    $form.Controls.Add($refreshButton)

    $patchButton = New-Object System.Windows.Forms.Button
    $patchButton.Text = "Patch blue.dll"
    $patchButton.SetBounds(770, 525, 110, 36)
    $patchButton.Anchor = "Top, Right"
    $form.Controls.Add($patchButton)

    $logLabel = New-Object System.Windows.Forms.Label
    $logLabel.Text = "Activity"
    $logLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
    $logLabel.SetBounds(20, 530, 120, 22)
    $form.Controls.Add($logLabel)

    $logBox = New-Object System.Windows.Forms.TextBox
    $logBox.Multiline = $true
    $logBox.ReadOnly = $true
    $logBox.ScrollBars = "Vertical"
    $logBox.Font = New-Object System.Drawing.Font("Consolas", 9)
    $logBox.SetBounds(20, 555, 860, 90)
    $logBox.Anchor = "Top, Bottom, Left, Right"
    $form.Controls.Add($logBox)

    $appendLog = {
        param([string]$Message)
        $logBox.AppendText($Message + [Environment]::NewLine)
    }

    $setStatus = {
        param([string]$State, [string]$Summary, [string]$PathText, [string]$SizeText, [string]$HashText, [string]$ActionText)
        $style = $stateStyles[$State]
        if (-not $style) {
            $style = $stateStyles["unknown"]
        }
        $statusBadge.Text = $style.Text
        $statusBadge.ForeColor = $style.Fore
        $statusBadge.BackColor = $style.Back
        $summaryLabel.Text = $Summary
        $detailBox.Text = @(
            "Selected File : $PathText"
            "Size          : $SizeText"
            "SHA-256       : $HashText"
            "Next Step     : $ActionText"
        ) -join [Environment]::NewLine
    }

    $updateOutputState = {
        $isSeparate = $separateRadio.Checked
        $outputBox.Enabled = $isSeparate
        $outputBrowseButton.Enabled = $isSeparate
        if ($isSeparate -and [string]::IsNullOrWhiteSpace($outputBox.Text) -and -not [string]::IsNullOrWhiteSpace($inputBox.Text)) {
            $outputBox.Text = Get-DefaultOutputPath (Resolve-AbsolutePath $inputBox.Text)
        }
    }

    $refreshInspection = {
        & $updateOutputState
        $inputText = $inputBox.Text.Trim()
        if ([string]::IsNullOrWhiteSpace($inputText)) {
            & $setStatus "missing" "Choose a blue.dll to inspect." "-" "-" "-" "Pick a file from the EVE client's bin64 folder."
            $patchButton.Enabled = $false
            $patchButton.Text = "Patch blue.dll"
            return
        }

        $inspection = Get-BlueDllInspection -Path $inputText -Manifest $manifest
        $sizeText = if ($null -ne $inspection.Size) { "{0:N0} bytes" -f $inspection.Size } else { "-" }
        $hashText = if ($inspection.Sha256) { $inspection.Sha256 } else { "-" }

        & $setStatus $inspection.State $inspection.Summary $inspection.Path $sizeText $hashText $inspection.Action
        $patchButton.Enabled = [bool]$inspection.CanPatch
        $patchButton.Text = if ($inspection.State -eq "patchable_variant") { "Attempt Patch Anyway" } else { "Patch blue.dll" }
    }

    $browseButton.Add_Click({
        $startDir = if ([string]::IsNullOrWhiteSpace($inputBox.Text)) { [Environment]::GetFolderPath("Desktop") } else { Split-Path -Parent $inputBox.Text }
        $dialog = New-Object System.Windows.Forms.OpenFileDialog
        $dialog.Title = "Choose blue.dll"
        $dialog.Filter = "DLL files (*.dll)|*.dll|All files (*.*)|*.*"
        $dialog.InitialDirectory = $startDir
        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            $inputBox.Text = $dialog.FileName
        }
    })

    $configuredButton.Add_Click({
        $candidate = Get-ConfiguredBlueDllPath
        if ($candidate) {
            $inputBox.Text = $candidate
            & $appendLog "Loaded configured client path: $candidate"
        } else {
            & $appendLog "No configured client path was found."
        }
    })

    $outputBrowseButton.Add_Click({
        $dialog = New-Object System.Windows.Forms.SaveFileDialog
        $dialog.Title = "Save patched blue.dll"
        $dialog.Filter = "DLL files (*.dll)|*.dll|All files (*.*)|*.*"
        $dialog.FileName = if ([string]::IsNullOrWhiteSpace($outputBox.Text)) { "blue.patched.dll" } else { $outputBox.Text }
        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            $outputBox.Text = $dialog.FileName
        }
    })

    $refreshButton.Add_Click({ & $refreshInspection })
    $inputBox.Add_TextChanged({ & $refreshInspection })
    $inPlaceRadio.Add_CheckedChanged({ & $updateOutputState })
    $separateRadio.Add_CheckedChanged({ & $updateOutputState })

    $patchButton.Add_Click({
        $inputText = $inputBox.Text.Trim()
        if ([string]::IsNullOrWhiteSpace($inputText)) {
            [System.Windows.Forms.MessageBox]::Show("Choose a blue.dll first.", $title, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
            return
        }

        try {
            $inspection = Get-BlueDllInspection -Path $inputText -Manifest $manifest
            $allowRelaxed = ($inspection.State -eq "patchable_variant")
            if ($inPlaceRadio.Checked) {
                $result = Apply-BlueDllPatch -InputPath $inputText -InPlace -BackupSuffix $backupBox.Text.Trim() -Manifest $manifest -AllowRelaxedVariant:$allowRelaxed
            } else {
                $resolvedOutput = if ([string]::IsNullOrWhiteSpace($outputBox.Text)) { Get-DefaultOutputPath (Resolve-AbsolutePath $inputText) } else { $outputBox.Text.Trim() }
                $result = Apply-BlueDllPatch -InputPath $inputText -OutputPath $resolvedOutput -Manifest $manifest -AllowRelaxedVariant:$allowRelaxed
            }
        } catch [AlreadyPatchedError] {
            & $appendLog $_.Exception.Message
            [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, $title, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
            return
        } catch [PatchValidationError] {
            & $appendLog "Validation failed: $($_.Exception.Message)"
            [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, $title, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
            return
        } catch [PatchError] {
            & $appendLog "Patch failed: $($_.Exception.Message)"
            [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, $title, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
            return
        } catch {
            & $appendLog "Unexpected error: $($_.Exception.Message)"
            [System.Windows.Forms.MessageBox]::Show("Unexpected error:`r`n$($_.Exception.Message)", $title, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
            return
        }

        if ($result.UsedRelaxedValidation) {
            & $appendLog "Attempt Patch Anyway succeeded and the output matches the canonical EvEJS target hash."
        }
        & $appendLog "Patched successfully: $($result.OutputPath)"
        & $appendLog "SHA-256: $($result.Sha256)"
        if ($result.BackupPath) {
            $backupStatus = if ($result.BackupCreated) { "created" } else { "already existed" }
            & $appendLog "Backup: $($result.BackupPath) ($backupStatus)"
        }

        $message = @(
            "Patched successfully:"
            $result.OutputPath
            ""
            "SHA-256:"
            $result.Sha256
        )
        if ($result.UsedRelaxedValidation) {
            $message += ""
            $message += "Attempt Patch Anyway verification passed."
            $message += "The final file matches the canonical EvEJS target hash."
        }
        if ($result.BackupPath) {
            $message += ""
            $message += "Backup:"
            $message += $result.BackupPath
        }

        [System.Windows.Forms.MessageBox]::Show(($message -join [Environment]::NewLine), $title, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
        & $refreshInspection
    })

    $prefill = if ([string]::IsNullOrWhiteSpace($InitialPath)) { Get-ConfiguredBlueDllPath } else { $InitialPath }
    if ($prefill) {
        $inputBox.Text = $prefill
    } else {
        & $refreshInspection
    }

    [void]$form.ShowDialog()
}

function Invoke-BlueDllPatchMain {
    param([string[]]$Arguments)

    $options = $null
    try {
        $options = Parse-BlueDllArguments $Arguments
        if ($options.Help) {
            Write-Output (Show-Usage)
            return 0
        }

        if ($options.Gui) {
            Start-BlueDllPatchGui -InitialPath $options.Input -ManifestPath $options.Manifest
            return 0
        }

        if ([string]::IsNullOrWhiteSpace($options.Input)) {
            Write-Output "Missing required --input."
            Write-Output ""
            Write-Output (Show-Usage)
            return 1
        }

        $manifest = Load-BlueDllPatchManifest $options.Manifest
        if ($options.Inspect) {
            $inspection = Get-BlueDllInspection -Path $options.Input -Manifest $manifest
            Write-Output (Format-BlueDllInspection $inspection)
            return 0
        }

        $result = Apply-BlueDllPatch `
            -InputPath $options.Input `
            -OutputPath $options.Output `
            -InPlace:$options.InPlace `
            -BackupSuffix $options.BackupSuffix `
            -Manifest $manifest `
            -Force:$options.Force `
            -AllowRelaxedVariant:$options.AttemptAnyway
        Write-Output (Format-BlueDllPatchResult $result)
        return 0
    } catch [PatchError] {
        if ($options -and $options.Gui) {
            Show-StartupError $_.Exception.Message
        } else {
            Write-Output $_.Exception.Message
        }
        return 1
    } catch {
        if ($options -and $options.Gui) {
            Show-StartupError $_.Exception.Message
        } else {
            Write-Output $_.Exception.Message
        }
        return 1
    }
}

$scriptExitCode = Invoke-BlueDllPatchMain -Arguments $args
$global:LASTEXITCODE = $scriptExitCode
