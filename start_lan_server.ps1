param(
    [int]$Port = 8080,
    [string]$LanIp = "10.189.34.5",
    [string]$BindAddress = "0.0.0.0"
)

$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverPath = Join-Path $projectDirectory "server.py"

if (-not (Test-Path -LiteralPath $serverPath)) {
    throw "server.py was not found in $projectDirectory"
}

Write-Host "Starting the shared CCB Fault Analyser..." -ForegroundColor Cyan
Write-Host "LAN URL: http://${LanIp}:$Port/" -ForegroundColor Green
Write-Host "Database: $(Join-Path $projectDirectory 'ccb_fleet.sqlite')"
Write-Host "Keep this window open. Press Ctrl+C to stop the server."

& py -3 $serverPath --host $BindAddress --port $Port --advertise-host $LanIp
