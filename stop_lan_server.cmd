@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop_lan_server.ps1"
if errorlevel 1 pause
