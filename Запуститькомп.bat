@echo off
cd /d "%~dp0"
rem Если сервер уже запущен — второй не стартуем (двое на одном порту дают пустую страницу)
netstat -ano | findstr :8723 | findstr LISTENING >nul
if %errorlevel%==0 (
  start http://localhost:8723
  exit /b
)
start "Configurator server - do not close" py scripts\dev-server.py 8723
ping -n 3 127.0.0.1 >nul
start http://localhost:8723
