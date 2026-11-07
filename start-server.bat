@echo off
chcp 65001 >nul
title فاکتورخوان — سرور
cd /d "%~dp0"

if not exist "venv" (
    echo ساخت محیط مجازی ...
    python -m venv venv || goto :err
    call venv\Scripts\activate.bat
    pip install -r backend\requirements.txt || goto :err
) else (
    call venv\Scripts\activate.bat
)

echo.
echo ============================================================
echo   فاکتورخوان اجرا شد:  http://127.0.0.1:8000
echo   برای توقف: Ctrl + C
echo ============================================================
echo.
cd backend
python run.py %*
exit /b 0

:err
echo خطا در راه اندازی. پایتون 3.11+ نصب است؟
pause
exit /b 1
