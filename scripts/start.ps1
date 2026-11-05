param(
    [switch]$Visible,
    [switch]$Login
)

$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDir
$exitCode = 0
$ownsMutex = $false
$mutex = $null
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Node.js is missing. Install Node.js >= 22.13, then try again.'
    }
    if (-not (Test-Path -LiteralPath '.env')) {
        throw '.env is missing. Copy .env.example to .env and configure it first.'
    }
    if (-not (Test-Path -LiteralPath 'node_modules/ws')) {
        throw 'Dependencies are missing. Run npm install first.'
    }
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try {
        $key = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectDir.ToLowerInvariant()))).Replace('-', '')
    } finally { $hash.Dispose() }
    $mutex = New-Object System.Threading.Mutex($false, "Local\DouyinLuma-$key")
    try { $ownsMutex = $mutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) {
        Write-Host 'DouyinLuma already has a launcher running. Use its existing window.'
    } else {
        $portOutput = & node --env-file=.env --input-type=module -e "import {configFromEnv} from './src/config.mjs'; if(Number(process.versions.node.split('.')[0])<22||(Number(process.versions.node.split('.')[0])===22&&Number(process.versions.node.split('.')[1])<13))throw Error('Node.js >= 22.13 is required'); console.log(configFromEnv().adminPort);"
        if ($LASTEXITCODE -ne 0) { throw 'Cannot load configuration. Check the error above.' }
        $adminPort = [int]($portOutput | Select-Object -Last 1)
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $connection = $client.ConnectAsync('127.0.0.1', $adminPort)
            try { $null = $connection.Wait(1000) } catch { }
            $portInUse = $client.Connected
        } finally { $client.Dispose() }
        if ($portInUse) {
            Write-Host "Port $adminPort is already in use. DouyinLuma may already be running. No second instance was started."
        } else {
            $nodeArgs = @('--env-file=.env', 'src/index.mjs')
            if ($Login) { $nodeArgs += '--login' }
            elseif ($Visible) { $nodeArgs += '--visible' }
            Write-Host 'Starting DouyinLuma. Keep this window open; press Ctrl+C to stop.'
            Write-Host "Admin: http://127.0.0.1:$adminPort/"
            & node @nodeArgs
            $exitCode = $LASTEXITCODE
        }
    }
} catch {
    Write-Host ('Start failed: ' + $_.Exception.Message) -ForegroundColor Red
    $exitCode = 1
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    if ($null -ne $mutex) { $mutex.Dispose() }
}
exit $exitCode
