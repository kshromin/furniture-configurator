@echo off
cd /d "%~dp0"
chcp 65001 >nul
rem Загрузка правок из «для работы\цены.xlsx» обратно в каталог (см. scripts\prices_import.py)
"C:\Users\user\AppData\Local\Programs\Python\Python312\python.exe" -X utf8 scripts\prices_import.py
