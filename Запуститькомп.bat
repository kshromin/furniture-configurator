@echo off
cd /d "%~dp0"
start "Configurator server - do not close" py -m http.server 8723
ping -n 3 127.0.0.1 >nul
start http://localhost:8723
