param([Parameter(Mandatory=$true)][string]$TargetRoot,[Parameter(Mandatory=$true)][string]$SourceDB,[Parameter(Mandatory=$true)][string]$BackupDir,[ValidateSet('BackupOnly','BackupMigrate','VerifyBackup','RollbackHold')][string]$Mode='VerifyBackup',[int]$CorePort=47831,[string]$NodeExe='node')
$ErrorActionPreference='Stop'
try {
 $cores=Get-CimInstance Win32_Process | Where-Object {($_.Name -match '^BONO.*\.exe$') -or ($_.Name -eq 'node.exe' -and (-not $_.CommandLine -or $_.CommandLine -match 'bridge[\\/](server|worker)\.js'))}
 if($cores){throw 'Desktop/Core active or unknown process'}
 & $NodeExe (Join-Path $PSScriptRoot 'query_transition.js') ([IO.Path]::GetFullPath($TargetRoot)) ([IO.Path]::GetFullPath($SourceDB)) ([IO.Path]::GetFullPath($BackupDir)) $Mode $CorePort
 exit $LASTEXITCODE
}catch {Write-Output 'Query transition preflight rejected; no process stopped';exit 1}
