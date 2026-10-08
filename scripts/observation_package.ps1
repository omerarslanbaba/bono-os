param([Parameter(Mandatory=$true)][string]$TargetRoot,[ValidateSet('Verify','Apply','Rollback')][string]$Mode='Verify',[ValidateRange(1024,65535)][int]$CorePort=47831)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($TargetRoot).TrimEnd('\')
$bundle=$PSScriptRoot
$manifest=Get-Content -LiteralPath (Join-Path $bundle 'version-manifest.json') -Raw | ConvertFrom-Json
function Digest($p){if(Test-Path -LiteralPath $p){([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([IO.File]::ReadAllBytes($p)))).Replace('-','').ToLower()}else{$null}}
foreach($entry in $manifest.files){
 $dest=[IO.Path]::GetFullPath((Join-Path $root $entry.path))
 if(-not $dest.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe package path'}
 if((Digest (Join-Path (Join-Path $bundle 'payload') $entry.path)) -ne $entry.sha256){throw "Payload hash mismatch: $($entry.path)"}
 if($entry.beforeSha256 -and (Digest (Join-Path (Join-Path $bundle 'rollback') $entry.path)) -ne $entry.beforeSha256){throw 'Rollback hash mismatch'}
 $expected=if($Mode -eq 'Rollback'){$entry.sha256}else{$entry.beforeSha256}
 if((Digest $dest) -ne $expected -and -not ($Mode -eq 'Rollback' -and (Digest $dest) -eq $entry.beforeSha256)){throw "Target changed: $($entry.path). Rebuild package; do not overwrite."}
}
if($Mode -eq 'Verify'){Write-Output "VERIFIED $($manifest.buildId); no target changes";exit 0}
if([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port -contains $CorePort){throw 'Core port occupied; stop only after separately approved maintenance procedure'}
# All files are checked before any mutation. No DB, queue, session or archive operations.
foreach($entry in $manifest.files){
 $dest=[IO.Path]::GetFullPath((Join-Path $root $entry.path))
 if($Mode -eq 'Rollback' -and (Digest $dest) -eq $entry.beforeSha256){continue}
 if($Mode -eq 'Rollback' -and -not $entry.beforeSha256){Remove-Item -LiteralPath $dest;continue}
 $folder=if($Mode -eq 'Rollback'){'rollback'}else{'payload'}
 New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
 Copy-Item -LiteralPath (Join-Path (Join-Path $bundle $folder) $entry.path) -Destination $dest
}
Write-Output "$Mode completed. No process started, no Chrome reload performed. Keep evidence DB separately."
