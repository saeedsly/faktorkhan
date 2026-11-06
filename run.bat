@echo off
REM فاکتورخوان — لاینر ویندوز
setlocal
cd /d "%~dp0"

if not exist ".venv" (
    echo ایجاد محیط مجازی...
    python -m venv .venv
)

echo نصب وابستگی‌ها...
.call .venv\Scripts\pip install -r requirements.txt

echo اجرای فاکتورخوان...
.call .venv\Scripts\python main.py

pause
