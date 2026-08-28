$ErrorActionPreference = "Stop"
$projectDirectory = (Split-Path -Parent $MyInvocation.MyCommand.Path)
$expectedServer = Join-Path $projectDirectory "server.py"
$listeners = @(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue)

if (-not $listeners.Count) {
    Write-Host "The CCB LAN server is not running on port 8080."
    exit
}
foreach ($listener in $listeners) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    if ($process.CommandLine -notlike "*$expectedServer*") {
        throw "Port 8080 belongs to another application and was not stopped."
    }
    Stop-Process -Id $process.ProcessId
    Write-Host "CCB LAN server stopped." -ForegroundColor Green
}
