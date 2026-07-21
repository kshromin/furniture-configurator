@echo off
cd /d "%~dp0"
chcp 65001 >nul
rem Выгрузка цен и ассортимента в «для работы\цены.xlsx» (см. scripts\prices_export.py)
"C:\Users\user\AppData\Local\Programs\Python\Python312\python.exe" -X utf8 scripts\prices_export.py
