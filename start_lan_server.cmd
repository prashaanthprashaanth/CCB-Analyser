@echo off
title CCB Fault Analyser LAN Server
py -3 "%~dp0server.py" --host 0.0.0.0 --port 8080 --advertise-host 10.189.34.5
if errorlevel 1 pause
