param([Parameter(Mandatory=$true)][string]$TargetRoot,[Parameter(Mandatory=$true)][string]$NodeExe,[Parameter(Mandatory=$true)][string]$SourceDB,[Parameter(Mandatory=$true)][string]$EvidenceDB,[Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,[ValidateRange(1024,65535)][int]$CorePort=47831)
$ErrorActionPreference='Stop'
$saved=@{};$keys=@('BONO_OBSERVATION_ONLY','BONO_DB_PATH','BONO_OBSERVATION_DB_PATH','BONO_OBSERVATION_BUILD_ID','BONO_OBSERVATION_EXTENSION_ID','BONO_PORT')
foreach($key in $keys){$saved[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
$result=1
try {
 if([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port -contains $CorePort){throw 'Port occupied'}
 $cores=Get-CimInstance Win32_Process | Where-Object {($_.Name -match '^BONO.*\.exe$') -or ($_.Name -eq 'node.exe' -and (-not $_.CommandLine -or $_.CommandLine -match 'bridge[\\/]server\.js'))}
 if($cores){throw 'BONO desktop/Core active'}
 & $NodeExe (Join-Path $PSScriptRoot 'launch_observation.js') $PSScriptRoot ([IO.Path]::GetFullPath($TargetRoot)) ([IO.Path]::GetFullPath($SourceDB)) ([IO.Path]::GetFullPath($EvidenceDB)) $ExtensionId $CorePort
 $result=$LASTEXITCODE
 if($null -eq $result){$result=1}
}catch {Write-Output 'Observer launch rejected; no existing process stopped';$result=1}
finally{foreach($key in $keys){[Environment]::SetEnvironmentVariable($key,$saved[$key],'Process')}}
exit $result
