@echo off
cd /d "%~dp0"
start "Configurator server - do not close" "C:\Users\user\AppData\Local\Programs\Python\Python312\python.exe" -m http.server 8723
ping -n 3 127.0.0.1 >nul
start http://localhost:8723
