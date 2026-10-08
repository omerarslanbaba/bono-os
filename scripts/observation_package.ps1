param([Parameter(Mandatory=$true)][string]$TargetRoot,[ValidateSet('Verify','Apply','Rollback','Recover')][string]$Mode='Verify',[ValidateRange(1024,65535)][int]$CorePort=47831,[string]$NodeExe='node')
$ErrorActionPreference='Stop'
try {
 if($Mode -ne 'Verify') {
  $cores=Get-CimInstance Win32_Process | Where-Object {($_.Name -match '^BONO.*\.exe$') -or ($_.Name -eq 'node.exe' -and (-not $_.CommandLine -or $_.CommandLine -match 'bridge[\\/](server|worker)\.js'))}
  if($cores){throw 'BONO desktop/Core active; approved maintenance must stop them first'}
 }
 & $NodeExe (Join-Path $PSScriptRoot 'package_operations.js') $PSScriptRoot ([IO.Path]::GetFullPath($TargetRoot)) $Mode $CorePort
 $result=$LASTEXITCODE
 if($null -eq $result){throw 'Missing Node exit status'}
 exit $result
} catch {Write-Output 'Package preflight failed; no process stopped';exit 1}
