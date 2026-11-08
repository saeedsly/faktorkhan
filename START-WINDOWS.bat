@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title فاکتورخوان — اجرا روی ویندوز
cd /d "%~dp0"

echo ================================================================
echo    فاکتورخوان  ^|  سامانه هوشمند خوانش و مدیریت فاکتور
echo    پدیدآورنده: سعید سالاری
echo ================================================================
echo.

REM ── گام ۱: بررسی نصب پایتون ───────────────────────────────────
set "PYCMD=python"
where python >nul 2>&1
if errorlevel 1 (
    where py >nul 2>&1
    if errorlevel 1 goto :nopython
    set "PYCMD=py -3"
)
%PYCMD% -c "import sys" >nul 2>&1
if errorlevel 1 goto :nopython
for /f "tokens=2" %%v in ('%PYCMD% --version 2^>^&1') do set "PYVER=%%v"
echo [۱/۴] پایتون نسخه !PYVER! پیدا شد.

REM ── گام ۲: ساخت محیط اجرا ─────────────────────────────────────
if not exist "venv\Scripts\python.exe" (
    echo [۲/۴] ساخت محیط اجرا ^(یک‌بار انجام می‌شود، حدود ۳۰ ثانیه^) ...
    %PYCMD% -m venv venv
    if errorlevel 1 goto :errvenv
) else (
    echo [۲/۴] محیط اجرا موجود است.
)

REM ── گام ۳: نصب کتابخانه‌ها ────────────────────────────────────
if not exist "venv\.installed" (
    echo [۳/۴] نصب کتابخانه‌ها ^(نیاز به اینترنت، یک‌بار^) ...
    venv\Scripts\python.exe -m pip install --upgrade pip --quiet
    venv\Scripts\python.exe -m pip install -r backend\requirements.txt --quiet
    if errorlevel 1 goto :errpip
    echo ok> "venv\.installed"
) else (
    echo [۳/۴] کتابخانه‌ها نصب هستند.
)

REM ── گام ۴: تنظیمات اولیه ──────────────────────────────────────
if not exist ".env" (
    if exist "backend\.env.example" (
        copy /y "backend\.env.example" ".env" >nul
        echo [۴/۴] فایل تنظیمات ساخته شد: .env  ^(برای حالت ساده نیازی به تغییر ندارد^)
    )
) else (
    echo [۴/۴] فایل تنظیمات موجود است.
)

echo.
echo ================================================================
echo   برنامه در حال اجراست:   http://127.0.0.1:8000
echo.
echo   اطلاعات ورود اولیه در این فایل است:
echo      storage\OWNER-CREDENTIALS.txt
echo.
echo   این پنجره را نبندید ^(برنامه تا وقتی این پنجره باز است فعال است^).
echo   برای توقف برنامه:  Ctrl + C   یا بستن این پنجره
echo ================================================================
echo.

cd backend
..\venv\Scripts\python.exe run.py --host 127.0.0.1 --port 8000
if errorlevel 1 (
    echo.
    echo [خطا] برنامه متوقف شد. متن خطای بالا را بررسی کنید.
    echo        اگر پیام «address already in use» بود، یعنی برنامه از قبل باز است
    echo        و کافی است نشانی http://127.0.0.1:8000 را در مرورگر باز کنید.
    pause
)
exit /b 0

:nopython
echo [خطا] پایتون پیدا نشد.
echo.
echo   ۱. به نشانی زیر بروید:  https://www.python.org/downloads/windows/
echo   ۲. نسخه 3.11 یا بالاتر را نصب کنید.
echo   ۳. در صفحه اول نصب، تیک «Add python.exe to PATH» را بزنید.
echo   ۴. این پنجره را ببندید و دوباره فایل را اجرا کنید.
echo.
pause
exit /b 1

:errvenv
echo.
echo [خطا] ساخت محیط اجرا ناموفق بود.
echo   • مطمئن شوید پایتون کامل نصب شده است ^(نسخه 3.11 یا بالاتر^).
echo   • پوشه پروژه را در مسیری بدون فاصله و بدون حروف غیرانگلیسی بگذارید، مثل C:\faktorkhan
echo.
pause
exit /b 1

:errpip
echo.
echo [خطا] نصب کتابخانه‌ها ناموفق بود.
echo   • اتصال اینترنت را بررسی کنید.
echo   • اگر پشت پروکسی هستید، در پنجره فرمان اجرا کنید:
echo        set HTTP_PROXY=http://proxy:port
echo        set HTTPS_PROXY=http://proxy:port
echo   • سپس دوباره این فایل را اجرا کنید.
echo.
pause
exit /b 1
