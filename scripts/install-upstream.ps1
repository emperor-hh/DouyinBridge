$ErrorActionPreference = 'Stop'
$repo = 'https://github.com/LockyBee/dsh-douyin-agent.git'
$dest = Join-Path $PSScriptRoot '..\upstream\dsh-douyin-agent'
if (-not (Test-Path $dest)) { git clone $repo $dest }
Push-Location $dest
try {
  git checkout 912873e2556d16a088d81dcbc6f7c0060614dd58
  pnpm install --frozen-lockfile
} finally { Pop-Location }
Write-Host 'Set UPSTREAM_DIR to the absolute path of upstream/dsh-douyin-agent'
