@echo off
REM فاکتورخوان — نصب کامل ویندوز
setlocal
cd /d "%~dp0"

echo ============================================
echo  فاکتورخوان - نصب و اجرا
echo ============================================

if not exist ".venv" (
    echo [1/3] ایجاد محیط مجازی...
    python -m venv .venv
)

echo [2/3] نصب وابستگی‌ها...
.call .venv\Scripts\pip install -r requirements.txt

echo [3/3] اجرای فاکتورخوان...
.call .venv\Scripts\python main.py

pause
