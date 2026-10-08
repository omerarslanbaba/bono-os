param(
    [ValidateSet("Plan","Install","Rollback")]
    [string]$Mode = "Plan",
    [string]$PackagePath,
    [string]$RootPath = (Join-Path $env:LOCALAPPDATA "BONO OS Web Preview"),
    [string]$BackupPath,
    [switch]$Approve,
    [switch]$SkipCoreProbe,
    [switch]$TestSimulateFailureAfterSwap
)

$ErrorActionPreference = "Stop"
$ExeName = "BONO OS Web Desktop.exe"
$WebBundleName = "web-bundle.zip"
$ManifestName = "release-manifest.json"
$CurrentDir = Join-Path $RootPath "current"
$CurrentExe = Join-Path $CurrentDir $ExeName
$CurrentWebBundle = Join-Path $CurrentDir $WebBundleName
$CurrentManifest = Join-Path $CurrentDir $ManifestName
$BackupsDir = Join-Path $RootPath "backups"
$StagingDir = Join-Path $RootPath "staging"
$StateFile = Join-Path $RootPath "state.json"
$CoreHealthUri = "http://127.0.0.1:47831/health"

function Read-Manifest([string]$dir) {
    $path = Join-Path $dir $ManifestName
    if (-not (Test-Path $path)) { throw "Manifest missing: $path" }
    $m = Get-Content $path -Raw | ConvertFrom-Json
    if ($m.schemaVersion -ne 1) { throw "Unsupported manifest schema: $($m.schemaVersion)" }
    if ($m.product -ne "BONO OS Web Desktop Preview") { throw "Unexpected product: $($m.product)" }
    if ($m.executable -ne $ExeName) { throw "Unexpected executable: $($m.executable)" }
    if ($m.webBundle -ne $WebBundleName) { throw "Unexpected web bundle: $($m.webBundle)" }
    if (-not $m.webSha256) { throw "Manifest webSha256 is missing." }
    return $m
}

function File-Hash([string]$path) {
    if (-not (Test-Path $path)) { throw "File missing: $path" }
    return (Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-PackageIntegrity([string]$dir, $manifest) {
    $exe = Join-Path $dir $manifest.executable
    $web = Join-Path $dir $manifest.webBundle
    $exeActual = File-Hash $exe
    $webActual = File-Hash $web
    $exeExpected = ([string]$manifest.sha256).ToLowerInvariant()
    $webExpected = ([string]$manifest.webSha256).ToLowerInvariant()
    if ($exeActual -ne $exeExpected) { throw "EXE SHA-256 mismatch. expected=$exeExpected actual=$exeActual" }
    if ($webActual -ne $webExpected) { throw "Web bundle SHA-256 mismatch. expected=$webExpected actual=$webActual" }
    return [pscustomobject]@{ ExeSha256 = $exeActual; WebSha256 = $webActual }
}

function Test-CoreHealth {
    if ($SkipCoreProbe) { return "skipped" }
    try {
        $r = Invoke-WebRequest -Uri $CoreHealthUri -Method Get -TimeoutSec 3 -UseBasicParsing
        if ($r.StatusCode -eq 200) { return "healthy" }
        return "http_$($r.StatusCode)"
    } catch {
        return "unavailable"
    }
}

function Test-TargetUnlocked {
    if (-not (Test-Path $CurrentExe)) { return }
    foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
        try {
            if ($p.Path -and ([IO.Path]::GetFullPath($p.Path) -eq [IO.Path]::GetFullPath($CurrentExe))) {
                throw "BONO OS Web Preview is running. Close it before update or rollback."
            }
        } catch [System.Management.Automation.RuntimeException] { throw }
        catch { }
    }
    try {
        $s = [IO.File]::Open($CurrentExe,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        $s.Dispose()
    } catch {
        throw "Current WebView2 preview executable is locked. Close it before update."
    }
}

function Backup-Current {
    if (-not (Test-Path $CurrentExe)) { return $null }
    if (-not (Test-Path $CurrentManifest) -or -not (Test-Path $CurrentWebBundle)) {
        throw "Current fixed preview is missing manifest or web bundle; refusing unsafe backup."
    }

    New-Item -ItemType Directory -Force -Path $BackupsDir | Out-Null
    $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssfffZ")
    $dir = Join-Path $BackupsDir $stamp
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Copy-Item $CurrentExe (Join-Path $dir $ExeName)
    Copy-Item $CurrentWebBundle (Join-Path $dir $WebBundleName)
    Copy-Item $CurrentManifest (Join-Path $dir $ManifestName)
    Assert-PackageIntegrity $dir (Read-Manifest $dir) | Out-Null
    return $dir
}

function Restore-From([string]$dir) {
    $m = Read-Manifest $dir
    Assert-PackageIntegrity $dir $m | Out-Null
    New-Item -ItemType Directory -Force -Path $CurrentDir | Out-Null

    Copy-Item (Join-Path $dir $ExeName) ($CurrentExe + ".restore") -Force
    Copy-Item (Join-Path $dir $WebBundleName) ($CurrentWebBundle + ".restore") -Force
    Move-Item ($CurrentExe + ".restore") $CurrentExe -Force
    Move-Item ($CurrentWebBundle + ".restore") $CurrentWebBundle -Force
    Copy-Item (Join-Path $dir $ManifestName) $CurrentManifest -Force
    Assert-PackageIntegrity $CurrentDir (Read-Manifest $CurrentDir) | Out-Null
}

function Write-State($manifest,[string]$action) {
    [ordered]@{
        schemaVersion = 1
        product = "BONO OS Web Desktop Preview"
        action = $action
        version = $manifest.version
        commit = $manifest.commit
        webCommit = $manifest.webCommit
        sha256 = $manifest.sha256
        webSha256 = $manifest.webSha256
        updatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
        executablePath = $CurrentExe
        webBundlePath = $CurrentWebBundle
    } | ConvertTo-Json | Set-Content $StateFile -Encoding utf8
}

if ($Mode -eq "Plan") {
    if (-not $PackagePath) { throw "PackagePath is required for Plan." }
    $m = Read-Manifest $PackagePath
    $hashes = Assert-PackageIntegrity $PackagePath $m
    [pscustomobject]@{
        Action = "Plan"
        Product = $m.product
        Version = $m.version
        ExeCommit = $m.commit
        WebCommit = $m.webCommit
        CommitsMatch = ([string]$m.commit -eq [string]$m.webCommit)
        ExeSha256 = $hashes.ExeSha256
        WebSha256 = $hashes.WebSha256
        WebView2Runtime = $m.webView2Runtime
        CoreHealth = (Test-CoreHealth)
        FixedExecutablePath = $CurrentExe
        RequiresApproval = $true
        CurrentExists = (Test-Path $CurrentExe)
    }
    exit 0
}

if (-not $Approve) {
    throw "Refusing to modify WebView2 preview installation without explicit -Approve."
}

Test-TargetUnlocked
New-Item -ItemType Directory -Force -Path $RootPath,$CurrentDir,$BackupsDir,$StagingDir | Out-Null

if ($Mode -eq "Install") {
    if (-not $PackagePath) { throw "PackagePath is required for Install." }
    $sourceManifest = Read-Manifest $PackagePath
    Assert-PackageIntegrity $PackagePath $sourceManifest | Out-Null

    $stage = Join-Path $StagingDir ([Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    Copy-Item (Join-Path $PackagePath $ExeName) (Join-Path $stage $ExeName)
    Copy-Item (Join-Path $PackagePath $WebBundleName) (Join-Path $stage $WebBundleName)
    Copy-Item (Join-Path $PackagePath $ManifestName) (Join-Path $stage $ManifestName)
    Assert-PackageIntegrity $stage (Read-Manifest $stage) | Out-Null

    $backup = Backup-Current
    try {
        Copy-Item (Join-Path $stage $ExeName) ($CurrentExe + ".new") -Force
        Copy-Item (Join-Path $stage $WebBundleName) ($CurrentWebBundle + ".new") -Force

        Remove-Item $CurrentExe,$CurrentWebBundle -Force -ErrorAction SilentlyContinue
        Move-Item ($CurrentExe + ".new") $CurrentExe -Force
        Move-Item ($CurrentWebBundle + ".new") $CurrentWebBundle -Force
        Copy-Item (Join-Path $stage $ManifestName) $CurrentManifest -Force

        Assert-PackageIntegrity $CurrentDir (Read-Manifest $CurrentDir) | Out-Null
        if ($TestSimulateFailureAfterSwap) { throw "Simulated post-swap failure." }

        Write-State $sourceManifest "install"
        Write-Host "Installed $($sourceManifest.version) at $CurrentExe"
    } catch {
        if ($backup) {
            Remove-Item $CurrentExe,$CurrentWebBundle,$CurrentManifest -Force -ErrorAction SilentlyContinue
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
    if (-not $target) { throw "No WebView2 preview backup available for rollback." }

    $targetManifest = Read-Manifest $target
    Assert-PackageIntegrity $target $targetManifest | Out-Null
    $recovery = Backup-Current
    try {
        Restore-From $target
        Write-State $targetManifest "rollback"
        Write-Host "Rolled back to $($targetManifest.version) at $CurrentExe"
    } catch {
        if ($recovery) {
            Remove-Item $CurrentExe,$CurrentWebBundle,$CurrentManifest -Force -ErrorAction SilentlyContinue
            Restore-From $recovery
        }
        throw
    }
}
