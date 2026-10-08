$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$updater = Join-Path $here "native_preview_updater.ps1"
$root = Join-Path $env:TEMP ("bono-updater-test-" + [Guid]::NewGuid().ToString("N"))

function New-Package([string]$dir,[string]$version,[string]$commit,[string]$content) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $exe = Join-Path $dir "BONO OS Native.exe"
    Set-Content $exe $content -Encoding ascii
    $hash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    [ordered]@{
        schemaVersion = 1
        product = "BONO OS Native Preview"
        version = $version
        commit = $commit
        shortCommit = $commit.Substring(0,[Math]::Min(8,$commit.Length))
        builtAtUtc = (Get-Date).ToUniversalTime().ToString("o")
        executable = "BONO OS Native.exe"
        sha256 = $hash
        channel = "preview"
    } | ConvertTo-Json | Set-Content (Join-Path $dir "release-manifest.json") -Encoding utf8
}

try {
    $p1 = Join-Path $root "p1"
    $p2 = Join-Path $root "p2"
    $bad = Join-Path $root "bad"
    $installRoot = Join-Path $root "install"

    New-Package $p1 "0.1.0-preview.1" "11111111" "version-one"
    New-Package $p2 "0.1.0-preview.2" "22222222" "version-two"

    & $updater -Mode Plan -PackagePath $p1 -RootPath $installRoot | Out-Null

    & $updater -Mode Install -PackagePath $p1 -RootPath $installRoot -Approve
    $current = Join-Path $installRoot "current\BONO OS Native.exe"
    if ((Get-Content $current -Raw).Trim() -ne "version-one") { throw "Initial install failed." }

    $failed = $false
    try {
        & $updater -Mode Install -PackagePath $p2 -RootPath $installRoot -Approve -TestSimulateFailureAfterSwap
    } catch {
        $failed = $true
    }
    if (-not $failed) { throw "Simulated failure did not fail." }
    if ((Get-Content $current -Raw).Trim() -ne "version-one") { throw "Automatic recovery after failed update failed." }

    & $updater -Mode Install -PackagePath $p2 -RootPath $installRoot -Approve
    if ((Get-Content $current -Raw).Trim() -ne "version-two") { throw "Second install failed." }

    & $updater -Mode Rollback -RootPath $installRoot -Approve
    if ((Get-Content $current -Raw).Trim() -ne "version-one") { throw "Rollback failed." }

    Copy-Item $p2 $bad -Recurse
    Add-Content (Join-Path $bad "BONO OS Native.exe") "tamper"
    $hashRejected = $false
    try {
        & $updater -Mode Plan -PackagePath $bad -RootPath $installRoot | Out-Null
    } catch {
        $hashRejected = $true
    }
    if (-not $hashRejected) { throw "Tampered package was not rejected." }

    $state = Get-Content (Join-Path $installRoot "state.json") -Raw | ConvertFrom-Json
    if ($state.action -ne "rollback") { throw "State file did not record rollback." }

    Write-Host "PASS updater install/hash/failure-recovery/rollback tests"
} finally {
    Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}
