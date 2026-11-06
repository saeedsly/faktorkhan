@echo off
:: ================================================================
:: فاکتورخوان — نصب و اجرا یک‌ کلیکی برای ویندوز
:: ================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ============================================
echo   فاکتورخوان - نصب و اجرا
echo ============================================
echo.

:: 1. بررسی پایتون
echo [1/4] بررسی پایتون...
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo خطا: پایتون نصب نیست یا در PATH نیست.
    echo لطفاً ابتدا از https://www.python.org پایتون را دانلود و نصب کنید.
    echo در نصب، تيك "Add Python to PATH" را فعال کنید.
    pause
    exit /b 1
)
echo    پایتون پیدا شد.

:: 2. نصب وابستگی‌ها (با تلاش چندباره در صورت کند بودن اینترنت)
echo.
echo [2/4] نصب کتابخانه‌های مورد نیاز (این چند دقیقه طول می‌کشد)...

set "PKGS=PyQt6 Pillow opencv-python-headless pandas openpyxl cryptography pytest pytesseract python-dateutil"

:retry
pip install --timeout 60 --retries 5 %PKGS% >nul 2>&1
if errorlevel 1 (
    echo.
    echo نصب با خطا مواجه شد. تلاش در مصادر جایگزین...
    pip install --timeout 60 --retries 5 --index-url https://pypi.tuna.tsinghua.edu.cn/simple %PKGS% >nul 2>&1
    if errorlevel 1 (
        echo.
        echo خطا: نمی‌توان کتابخانه‌ها را دانلود کرد. اتصال اینترنت را بررسی کنید.
        pause
        exit /b 1
    )
)
echo    کتابخانه‌ها نصب شدند.

:: 3. اجرای برنامه
echo.
echo [3/4] اجرای فاکتورخوان...
python main.py
if errorlevel 1 (
    echo.
    echo برنامه با خطا مواجه شد. لاگ بالا را بررسی کنید.
    pause
    exit /b 1
)

:: 4. پایان
echo.
echo [4/4] انجام شد.
pause
