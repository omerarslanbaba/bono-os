$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$updater = Join-Path $here "web_desktop_updater.ps1"
$root = Join-Path $env:TEMP ("bono-web-updater-test-" + [Guid]::NewGuid().ToString("N"))

function New-Package([string]$dir,[string]$version,[string]$commit,[string]$content) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $exe = Join-Path $dir "BONO OS Web Desktop.exe"
    Set-Content $exe $content -Encoding ascii
    $hash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    [ordered]@{
        schemaVersion = 1
        product = "BONO OS Web Desktop Preview"
        version = $version
        commit = $commit
        shortCommit = $commit.Substring(0,[Math]::Min(8,$commit.Length))
        builtAtUtc = (Get-Date).ToUniversalTime().ToString("o")
        executable = "BONO OS Web Desktop.exe"
        sha256 = $hash
        webView2Runtime = "Evergreen required"
        webView2Sdk = "test"
        channel = "preview"
    } | ConvertTo-Json | Set-Content (Join-Path $dir "release-manifest.json") -Encoding utf8
}

try {
    $p1 = Join-Path $root "p1"
    $p2 = Join-Path $root "p2"
    $bad = Join-Path $root "bad"
    $installRoot = Join-Path $root "install"

    New-Package $p1 "0.1.0-webpreview.1" "11111111" "web-version-one"
    New-Package $p2 "0.1.0-webpreview.2" "22222222" "web-version-two"

    & $updater -Mode Plan -PackagePath $p1 -RootPath $installRoot -SkipCoreProbe | Out-Null

    $approvalRejected = $false
    try {
        & $updater -Mode Install -PackagePath $p1 -RootPath $installRoot -SkipCoreProbe
    } catch {
        $approvalRejected = $true
    }
    if (-not $approvalRejected) { throw "Install without -Approve was not rejected." }

    & $updater -Mode Install -PackagePath $p1 -RootPath $installRoot -Approve -SkipCoreProbe
    $current = Join-Path $installRoot "current\BONO OS Web Desktop.exe"
    if ((Get-Content $current -Raw).Trim() -ne "web-version-one") { throw "Initial WebView2 preview install failed." }

    $lock = [IO.File]::Open($current,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
    try {
        $lockRejected = $false
        try {
            & $updater -Mode Install -PackagePath $p2 -RootPath $installRoot -Approve -SkipCoreProbe
        } catch {
            $lockRejected = $true
        }
        if (-not $lockRejected) { throw "Install while WebView2 preview EXE was locked was not rejected." }
    } finally {
        $lock.Dispose()
    }

    $failed = $false
    try {
        & $updater -Mode Install -PackagePath $p2 -RootPath $installRoot -Approve -SkipCoreProbe -TestSimulateFailureAfterSwap
    } catch {
        $failed = $true
    }
    if (-not $failed) { throw "Simulated post-swap failure did not fail." }
    if ((Get-Content $current -Raw).Trim() -ne "web-version-one") { throw "Automatic recovery failed." }

    & $updater -Mode Install -PackagePath $p2 -RootPath $installRoot -Approve -SkipCoreProbe
    if ((Get-Content $current -Raw).Trim() -ne "web-version-two") { throw "Second install failed." }

    & $updater -Mode Rollback -RootPath $installRoot -Approve -SkipCoreProbe
    if ((Get-Content $current -Raw).Trim() -ne "web-version-one") { throw "Rollback failed." }

    Copy-Item $p2 $bad -Recurse
    Add-Content (Join-Path $bad "BONO OS Web Desktop.exe") "tamper"
    $hashRejected = $false
    try {
        & $updater -Mode Plan -PackagePath $bad -RootPath $installRoot -SkipCoreProbe | Out-Null
    } catch {
        $hashRejected = $true
    }
    if (-not $hashRejected) { throw "Tampered WebView2 package was not rejected." }

    $state = Get-Content (Join-Path $installRoot "state.json") -Raw | ConvertFrom-Json
    if ($state.action -ne "rollback") { throw "State file did not record rollback." }

    Write-Host "PASS WebView2 updater approval/lock/hash/failure-recovery/rollback tests"
} finally {
    Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}
