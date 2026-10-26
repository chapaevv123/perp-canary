$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

function Assert-LastExit($step) {
  if ($LASTEXITCODE -ne 0) { throw "$step failed with exit code $LASTEXITCODE" }
}

& npm.cmd install
Assert-LastExit 'npm install'

& node .\scripts\inspect-sdk.mjs
Assert-LastExit 'SDK export inspection'

$rpc = 'https://api.hideki2.infra.testnet.somnia.network'
$wss = 'wss://api.hideki2.infra.testnet.somnia.network/ws'
$body = @{ jsonrpc = '2.0'; id = 1; method = 'eth_chainId'; params = @() } | ConvertTo-Json -Compress
$chain = Invoke-RestMethod -Uri $rpc -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 15
$chainId = [Convert]::ToInt64($chain.result.Substring(2), 16)
Write-Host "Hideki RPC chain ID: $chainId"
if ($chainId -ne 50383) { throw "Wrong RPC chain ID $chainId" }

& node .\scripts\check-wss.mjs $wss
Assert-LastExit 'Hideki WSS'

& node .\scripts\snapshot-watchdog.mjs
Assert-LastExit 'Live SDK snapshot'
& npm.cmd run typecheck
Assert-LastExit 'Typecheck'
& npm.cmd run lint
Assert-LastExit 'Lint'
& npm.cmd test
Assert-LastExit 'Tests'
& npm.cmd run verify
Assert-LastExit 'Evidence verification'

Write-Host 'M0 host run complete. Review evidence/*.json before publishing.'
