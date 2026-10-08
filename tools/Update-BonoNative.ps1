param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$')][string]$Repo,
  [switch]$CheckOnly
)
$ErrorActionPreference='Stop'
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) { throw 'GitHub CLI (gh) kurulu değil. Önce GitHub CLI yükleyip gh auth login yapın.' }
& gh auth status 1>$null
if ($LASTEXITCODE -ne 0) { throw 'GitHub oturumu yok. gh auth login çalıştırın.' }
$target = Join-Path ([Environment]::GetFolderPath('Desktop')) 'BONO OS Native.exe'
if (-not (Test-Path -LiteralPath $target)) {
  $target = Join-Path $env:USERPROFILE 'OneDrive\Masaüstü\BONO OS Native.exe'
}
if (-not (Test-Path -LiteralPath $target)) { throw 'Mevcut BONO OS Native.exe bulunamadı.' }
$runs = & gh run list -R $Repo --workflow native-build.yml --branch main --status success --limit 1 --json databaseId,headSha
if ($LASTEXITCODE -ne 0) { throw 'Başarılı Windows derlemesi bulunamadı.' }
$run = @($runs | ConvertFrom-Json)[0]
if (-not $run) { throw 'Başarılı derleme yok.' }
Write-Host ('Bulunan derleme: '+$run.headSha)
if ($CheckOnly) { return }
$work = Join-Path $env:TEMP ('bono-update-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  & gh run download $run.databaseId -R $Repo -n bono-os-native -D $work
  if ($LASTEXITCODE -ne 0) { throw 'Derleme indirilemedi.' }
  $exe = Join-Path $work 'BONO OS Native.exe'
  $manifest = Join-Path $work 'SHA256SUMS.txt'
  if (!(Test-Path $exe) -or !(Test-Path $manifest)) { throw 'Eksik derleme dosyası.' }
  $expected = ((Get-Content $manifest -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
  $actual = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expected -ne $actual) { throw 'SHA256 doğrulaması başarısız.' }
  $app = Get-Process -Name 'BONO OS Native' -ErrorAction SilentlyContinue
  if ($app) {
    foreach($p in $app) { $null=$p.CloseMainWindow() }
    Start-Sleep -Seconds 3
    if (Get-Process -Name 'BONO OS Native' -ErrorAction SilentlyContinue) {
      throw 'Native pencere açık. Elle kapatıp güncelleyiciyi yeniden çalıştırın.'
    }
  }
  $backup = $target+'.previous'
  Copy-Item -LiteralPath $target -Destination $backup -Force
  try { Copy-Item -LiteralPath $exe -Destination $target -Force }
  catch { Copy-Item -LiteralPath $backup -Destination $target -Force; throw }
  if ((Get-FileHash $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $actual) {
    Copy-Item -LiteralPath $backup -Destination $target -Force
    throw 'Kurulum doğrulanamadı; eski sürüm geri yüklendi.'
  }
  Start-Process -FilePath $target
  Write-Host 'Mevcut BONO OS Native.exe güncellendi; önceki sürüm .previous dosyasında.'
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
