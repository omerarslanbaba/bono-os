$ErrorActionPreference = "SilentlyContinue"
$base = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$logDir = Join-Path $base "data\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "watchdog.log"
$mutex = New-Object System.Threading.Mutex($false, "Local\BONO_OS_WATCHDOG")
if (-not $mutex.WaitOne(0, $false)) { exit 0 }

function Write-BonoLog($message) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $message"
  Add-Content -Path $log -Value $line -Encoding UTF8
}
function Bono-Healthy {
  try {
    $r = Invoke-RestMethod "http://127.0.0.1:47831/health" -TimeoutSec 3
    return ($r.ok -eq $true)
  } catch { return $false }
}
function Start-Bono {
  $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
  if (-not $node) {
    Write-BonoLog "node.exe bulunamadı; BONO başlatılamadı"
    return
  }
  Start-Process -FilePath $node -ArgumentList "bridge/server.js" -WorkingDirectory $base -WindowStyle Hidden
  Start-Sleep -Seconds 2
  if (Bono-Healthy) { Write-BonoLog "BONO OS başlatıldı" }
  else { Write-BonoLog "BONO başlatma denemesi başarısız" }
}

try {
  if (-not (Bono-Healthy)) { Start-Bono }
  while ($true) {
    Start-Sleep -Seconds 15
    if (-not (Bono-Healthy)) {
      Write-BonoLog "Health-check başarısız; yeniden başlatılıyor"
      Start-Bono
    }
  }
} finally {
  try { $mutex.ReleaseMutex() } catch {}
  $mutex.Dispose()
}