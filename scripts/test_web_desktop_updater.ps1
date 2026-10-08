$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$updater = Join-Path $here "web_desktop_updater.ps1"
$root = Join-Path $env:TEMP ("bono-web-updater-test-" + [Guid]::NewGuid().ToString("N"))

function New-Package([string]$dir,[string]$version,[string]$commit,[string]$exeContent,[string]$webContent) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $exe = Join-Path $dir "BONO OS Web Desktop.exe"
    $web = Join-Path $dir "web-bundle.zip"
    Set-Content $exe $exeContent -Encoding ascii
    Set-Content $web $webContent -Encoding ascii
    $exeHash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    $webHash = (Get-FileHash $web -Algorithm SHA256).Hash.ToLowerInvariant()
    [ordered]@{
        schemaVersion = 1
        product = "BONO OS Web Desktop Preview"
        version = $version
        commit = $commit
        shortCommit = $commit.Substring(0,[Math]::Min(8,$commit.Length))
        webCommit = $commit
        executable = "BONO OS Web Desktop.exe"
        sha256 = $exeHash
        webBundle = "web-bundle.zip"
        webSha256 = $webHash
        webView2Runtime = "Evergreen required"
        webView2Sdk = "test"
        channel = "preview"
    } | ConvertTo-Json | Set-Content (Join-Path $dir "release-manifest.json") -Encoding utf8
}

try {
    $p1 = Join-Path $root "p1"
    $p2 = Join-Path $root "p2"
    $badExe = Join-Path $root "bad-exe"
    $badWeb = Join-Path $root "bad-web"
    $installRoot = Join-Path $root "install"

    New-Package $p1 "0.1.0-webpreview.1" "11111111" "exe-one" "web-one"
    New-Package $p2 "0.1.0-webpreview.2" "22222222" "exe-two" "web-two"

    & $updater -Mode Plan -PackagePath $p1 -RootPath $installRoot -SkipCoreProbe | Out-Null

    $approvalRejected = $false
    try { & $updater -Mode Install -PackagePath $p1 -RootPath $installRoot -SkipCoreProbe }
    catch { $approvalRejected = $true }
    if (-not $approvalRejected) { throw "Install without -Approve was not rejected." }

    & $updater -Mode Install -PackagePath $p1 -RootPath $installRoot -Approve -SkipCoreProbe
    $currentExe = Join-Path $installRoot "current\BONO OS Web Desktop.exe"
    $currentWeb = Join-Path $installRoot "current\web-bundle.zip"
    if ((Get-Content $currentExe -Raw).Trim() -ne "exe-one") { throw "Initial EXE install failed." }
    if ((Get-Content $currentWeb -Raw).Trim() -ne "web-one") { throw "Initial web bundle install failed." }

    $lock = [IO.File]::Open($currentExe,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
    try {
        $lockRejected = $false
        try { & $updater -Mode Install -PackagePath $p2 -RootPath $installRoot -Approve -SkipCoreProbe }
        catch { $lockRejected = $true }
        if (-not $lockRejected) { throw "Install while EXE was locked was not rejected." }
    } finally { $lock.Dispose() }

    $failed = $false
    try {
        & $updater -Mode Install -PackagePath $p2 -RootPath $installRoot -Approve -SkipCoreProbe -TestSimulateFailureAfterSwap
    } catch { $failed = $true }
    if (-not $failed) { throw "Simulated post-swap failure did not fail." }
    if ((Get-Content $currentExe -Raw).Trim() -ne "exe-one") { throw "EXE automatic recovery failed." }
    if ((Get-Content $currentWeb -Raw).Trim() -ne "web-one") { throw "Web bundle automatic recovery failed." }

    & $updater -Mode Install -PackagePath $p2 -RootPath $installRoot -Approve -SkipCoreProbe
    if ((Get-Content $currentExe -Raw).Trim() -ne "exe-two") { throw "Second EXE install failed." }
    if ((Get-Content $currentWeb -Raw).Trim() -ne "web-two") { throw "Second web bundle install failed." }

    & $updater -Mode Rollback -RootPath $installRoot -Approve -SkipCoreProbe
    if ((Get-Content $currentExe -Raw).Trim() -ne "exe-one") { throw "EXE rollback failed." }
    if ((Get-Content $currentWeb -Raw).Trim() -ne "web-one") { throw "Web bundle rollback failed." }

    Copy-Item $p2 $badExe -Recurse
    Add-Content (Join-Path $badExe "BONO OS Web Desktop.exe") "tamper"
    $exeRejected = $false
    try { & $updater -Mode Plan -PackagePath $badExe -RootPath $installRoot -SkipCoreProbe | Out-Null }
    catch { $exeRejected = $true }
    if (-not $exeRejected) { throw "Tampered EXE was not rejected." }

    Copy-Item $p2 $badWeb -Recurse
    Add-Content (Join-Path $badWeb "web-bundle.zip") "tamper"
    $webRejected = $false
    try { & $updater -Mode Plan -PackagePath $badWeb -RootPath $installRoot -SkipCoreProbe | Out-Null }
    catch { $webRejected = $true }
    if (-not $webRejected) { throw "Tampered web bundle was not rejected." }

    $state = Get-Content (Join-Path $installRoot "state.json") -Raw | ConvertFrom-Json
    if ($state.action -ne "rollback") { throw "State file did not record rollback." }
    if (-not $state.webSha256) { throw "State file did not record web bundle hash." }

    Write-Host "PASS WebView2 updater EXE+web approval/lock/hash/failure-recovery/rollback tests"
} finally {
    Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}
