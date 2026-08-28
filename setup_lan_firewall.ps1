$ErrorActionPreference = "Stop"
$ruleName = "CCB Fault Analyser LAN (TCP 8080)"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdministrator) {
    Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", "`"$PSCommandPath`""
    )
    exit
}

$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
    Set-NetFirewallRule -DisplayName $ruleName -Enabled True -Direction Inbound -Action Allow -Profile Any
} else {
    New-NetFirewallRule `
        -DisplayName $ruleName `
        -Description "Allows local-subnet clients to use the shared CCB Fault Analyser web server." `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort 8080 `
        -RemoteAddress LocalSubnet `
        -Profile Any | Out-Null
}

Write-Host "LAN firewall access is enabled for TCP port 8080 from the local subnet." -ForegroundColor Green
Write-Host "Press any key to close."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
