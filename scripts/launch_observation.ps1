param([Parameter(Mandatory=$true)][string]$TargetRoot,[Parameter(Mandatory=$true)][string]$NodeExe,[Parameter(Mandatory=$true)][string]$SourceDB,[Parameter(Mandatory=$true)][string]$EvidenceDB,[Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId)
$ErrorActionPreference='Stop'
if([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port -contains 47831){throw 'Port occupied; no process stopped'}
if([IO.Path]::GetFullPath($SourceDB) -eq [IO.Path]::GetFullPath($EvidenceDB)){throw 'Evidence must be separate'}
if(Test-Path -LiteralPath $EvidenceDB){throw 'Use a new evidence DB for this session'}
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'version-manifest.json') -Raw | ConvertFrom-Json
foreach($f in $manifest.files){if(([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([IO.File]::ReadAllBytes((Join-Path $TargetRoot $f.path))))).Replace('-','').ToLower() -ne $f.sha256){throw 'Installed file hash mismatch'}}
$env:BONO_OBSERVATION_ONLY='1';$env:BONO_DB_PATH=[IO.Path]::GetFullPath($SourceDB);$env:BONO_OBSERVATION_DB_PATH=[IO.Path]::GetFullPath($EvidenceDB)
$env:BONO_OBSERVATION_BUILD_ID=$manifest.buildId;$env:BONO_OBSERVATION_EXTENSION_ID=$ExtensionId;$env:BONO_PORT='47831'
try{& $NodeExe (Join-Path $TargetRoot 'bridge/server.js')}finally{foreach($key in @('BONO_OBSERVATION_ONLY','BONO_DB_PATH','BONO_OBSERVATION_DB_PATH','BONO_OBSERVATION_BUILD_ID','BONO_OBSERVATION_EXTENSION_ID','BONO_PORT')){Remove-Item -LiteralPath ('Env:'+ $key) -ErrorAction SilentlyContinue}}
