param(
    [ValidateSet("Plan","Install","Rollback")]
    [string]$Mode = "Plan",
    [string]$PackagePath,
    [string]$RootPath = (Join-Path $env:LOCALAPPDATA "BONO OS Preview"),
    [string]$BackupPath,
    [switch]$Approve,
    [switch]$TestSimulateFailureAfterSwap
)

$ErrorActionPreference = "Stop"
$ExeName = "BONO OS Native.exe"
$ManifestName = "release-manifest.json"
$CurrentDir = Join-Path $RootPath "current"
$CurrentExe = Join-Path $CurrentDir $ExeName
$CurrentManifest = Join-Path $CurrentDir $ManifestName
$BackupsDir = Join-Path $RootPath "backups"
$StagingDir = Join-Path $RootPath "staging"
$StateFile = Join-Path $RootPath "state.json"

function Read-Manifest([string]$dir) {
    $path = Join-Path $dir $ManifestName
    if (-not (Test-Path $path)) { throw "Manifest missing: $path" }
    $m = Get-Content $path -Raw | ConvertFrom-Json
    if ($m.schemaVersion -ne 1) { throw "Unsupported manifest schema: $($m.schemaVersion)" }
    if ($m.executable -ne $ExeName) { throw "Unexpected executable name: $($m.executable)" }
    return $m
}

function Assert-Hash([string]$dir, $manifest) {
    $exe = Join-Path $dir $manifest.executable
    if (-not (Test-Path $exe)) { throw "Executable missing: $exe" }
    $actual = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    $expected = ([string]$manifest.sha256).ToLowerInvariant()
    if ($actual -ne $expected) { throw "SHA-256 mismatch. expected=$expected actual=$actual" }
    return $actual
}

function Test-TargetUnlocked {
    if (-not (Test-Path $CurrentExe)) { return }
    foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
        try {
            if ($p.Path -and ([IO.Path]::GetFullPath($p.Path) -eq [IO.Path]::GetFullPath($CurrentExe))) {
                throw "BONO OS preview is running. Close it before update or rollback."
            }
        } catch [System.Management.Automation.RuntimeException] { throw }
        catch { }
    }
    try {
        $s = [IO.File]::Open($CurrentExe,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        $s.Dispose()
    } catch {
        throw "Current preview executable is locked. Close BONO OS before update."
    }
}

function Write-FallbackManifest([string]$dir) {
    $exe = Join-Path $dir $ExeName
    $hash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    [ordered]@{
        schemaVersion = 1
        product = "BONO OS Native Preview"
        version = "legacy"
        commit = "unknown"
        shortCommit = "unknown"
        builtAtUtc = $null
        executable = $ExeName
        sha256 = $hash
        channel = "preview"
    } | ConvertTo-Json | Set-Content (Join-Path $dir $ManifestName) -Encoding utf8
}

function Backup-Current {
    if (-not (Test-Path $CurrentExe)) { return $null }
    New-Item -ItemType Directory -Force -Path $BackupsDir | Out-Null
    $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssfffZ")
    $dir = Join-Path $BackupsDir $stamp
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Copy-Item $CurrentExe (Join-Path $dir $ExeName)
    if (Test-Path $CurrentManifest) {
        Copy-Item $CurrentManifest (Join-Path $dir $ManifestName)
    } else {
        Write-FallbackManifest $dir
    }
    $m = Read-Manifest $dir
    Assert-Hash $dir $m | Out-Null
    return $dir
}

function Restore-From([string]$dir) {
    $m = Read-Manifest $dir
    Assert-Hash $dir $m | Out-Null
    New-Item -ItemType Directory -Force -Path $CurrentDir | Out-Null
    Copy-Item (Join-Path $dir $ExeName) ($CurrentExe + ".restore") -Force
    Move-Item ($CurrentExe + ".restore") $CurrentExe -Force
    Copy-Item (Join-Path $dir $ManifestName) $CurrentManifest -Force
    Assert-Hash $CurrentDir (Read-Manifest $CurrentDir) | Out-Null
}

function Write-State($manifest, [string]$action) {
    New-Item -ItemType Directory -Force -Path $RootPath | Out-Null
    [ordered]@{
        schemaVersion = 1
        action = $action
        version = $manifest.version
        commit = $manifest.commit
        sha256 = $manifest.sha256
        updatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
        executablePath = $CurrentExe
    } | ConvertTo-Json | Set-Content $StateFile -Encoding utf8
}

if ($Mode -eq "Plan") {
    if (-not $PackagePath) { throw "PackagePath is required for Plan." }
    $m = Read-Manifest $PackagePath
    $hash = Assert-Hash $PackagePath $m
    [pscustomobject]@{
        Action = "Plan"
        Version = $m.version
        Commit = $m.commit
        Sha256 = $hash
        FixedExecutablePath = $CurrentExe
        RequiresApproval = $true
        CurrentExists = (Test-Path $CurrentExe)
    }
    exit 0
}

if (-not $Approve) {
    throw "Refusing to modify preview installation without explicit -Approve."
}

Test-TargetUnlocked
New-Item -ItemType Directory -Force -Path $RootPath,$CurrentDir,$BackupsDir,$StagingDir | Out-Null

if ($Mode -eq "Install") {
    if (-not $PackagePath) { throw "PackagePath is required for Install." }
    $sourceManifest = Read-Manifest $PackagePath
    Assert-Hash $PackagePath $sourceManifest | Out-Null
    $stage = Join-Path $StagingDir ([Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    Copy-Item (Join-Path $PackagePath $ExeName) (Join-Path $stage $ExeName)
    Copy-Item (Join-Path $PackagePath $ManifestName) (Join-Path $stage $ManifestName)
    Assert-Hash $stage (Read-Manifest $stage) | Out-Null

    $backup = Backup-Current
    try {
        Copy-Item (Join-Path $stage $ExeName) ($CurrentExe + ".new") -Force
        if (Test-Path $CurrentExe) { Remove-Item $CurrentExe -Force }
        Move-Item ($CurrentExe + ".new") $CurrentExe -Force
        Copy-Item (Join-Path $stage $ManifestName) $CurrentManifest -Force
        Assert-Hash $CurrentDir (Read-Manifest $CurrentDir) | Out-Null
        if ($TestSimulateFailureAfterSwap) { throw "Simulated post-swap failure." }
        Write-State $sourceManifest "install"
        Write-Host "Installed $($sourceManifest.version) at $CurrentExe"
    } catch {
        if ($backup) {
            Remove-Item $CurrentExe,$CurrentManifest -Force -ErrorAction SilentlyContinue
            Restore-From $backup
        }
        throw
    } finally {
        Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
    exit 0
}

if ($Mode -eq "Rollback") {
    $target = $BackupPath
    if (-not $target) {
        $target = Get-ChildItem $BackupsDir -Directory -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTimeUtc -Descending |
            Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $target) { throw "No backup available for rollback." }
    $targetManifest = Read-Manifest $target
    Assert-Hash $target $targetManifest | Out-Null
    $recovery = Backup-Current
    try {
        Restore-From $target
        Write-State $targetManifest "rollback"
        Write-Host "Rolled back to $($targetManifest.version) at $CurrentExe"
    } catch {
        if ($recovery) {
            Remove-Item $CurrentExe,$CurrentManifest -Force -ErrorAction SilentlyContinue
            Restore-From $recovery
        }
        throw
    }
}
