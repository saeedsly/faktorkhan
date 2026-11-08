@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title فاکتورخوان — حالت سرور (شبکه / اینترنت)
cd /d "%~dp0"

set "PORT=%~1"
if "%PORT%"=="" set "PORT=8000"

echo ================================================================
echo    فاکتورخوان — حالت سرور
echo    پدیدآورنده: سعید سالاری
echo ================================================================
echo.

REM ── انتخاب مفسر پایتون ────────────────────────────────────────
set "PYRUN="
if exist "python\python.exe" set "PYRUN=%~dp0python\python.exe"
if not defined PYRUN if exist "venv\Scripts\python.exe" set "PYRUN=%~dp0venv\Scripts\python.exe"
if not defined PYRUN (
    where python >nul 2>&1 && set "PYRUN=python"
)
if not defined PYRUN (
    where py >nul 2>&1 && set "PYRUN=py -3"
)
if not defined PYRUN (
    echo [خطا] پایتون پیدا نشد. اول START-WINDOWS.bat را اجرا کنید.
    pause
    exit /b 1
)

REM ── بررسی تنظیمات ─────────────────────────────────────────────
if not exist ".env" (
    echo [توجه] فایل .env نبود؛ از نمونه ساخته می‌شود.
    copy /y "backend\.env.example" ".env" >nul
)

set "DBURL="
set "HOSTS="
set "FORCEHTTPS="
set "BINDHOST=0.0.0.0"
for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    if /i "%%a"=="DATABASE_URL" set "DBURL=%%b"
    if /i "%%a"=="ALLOWED_HOSTS" set "HOSTS=%%b"
    if /i "%%a"=="FORCE_HTTPS" set "FORCEHTTPS=%%b"
    if /i "%%a"=="HOST" if not "%%b"=="" set "BINDHOST=%%b"
)

echo [۱/۳] بررسی تنظیمات ...
if "!DBURL!"=="" (
    echo    - پایگاه داده: SQLite ^(تک‌کاربره^)
    echo      برای چند کاربر: SETUP-MYSQL-WINDOWS.bat را اجرا کنید.
) else (
    echo    - پایگاه داده: MySQL
)
if "!HOSTS!"=="" (
    echo    - دامنه‌های مجاز: تعیین نشده ^(برای اینترنت حتماً تنظیم کنید^)
    echo      SETUP-MYSQL-WINDOWS.bat را دوباره اجرا کنید و دامنه را وارد کنید.
) else (
    echo    - دامنه‌های مجاز: !HOSTS!
)
if "!BINDHOST!"=="127.0.0.1" (
    echo    - انتشار: فقط از طریق Apache ^(پورت ۸۰۰۰ از بیرون بسته است^)
) else (
    echo    - انتشار: مستقیم روی شبکه/پورت %PORT%
)
if /i "!FORCEHTTPS!"=="1" (
    echo    - HTTPS: اجباری ^(پشت پراکسی Apache/nginx^)
) else (
    echo    - HTTPS: خاموش ^(اگر سایت روی اینترنت است، SETUP-MYSQL-WINDOWS را با گزینه HTTPS دوباره اجرا کنید^)
)

echo.
echo [۲/۳] باز کردن پورت در فایروال ویندوز ...
netsh advfirewall firewall show rule name="FactorKhan" >nul 2>&1
if errorlevel 1 (
    netsh advfirewall firewall add rule name="FactorKhan" dir=in action=allow protocol=TCP localport=%PORT% >nul 2>&1
    if errorlevel 1 (
        echo    - نشد ^(اجرای این فایل با کلیک راست → Run as administrator لازم است^)
    ) else (
        echo    - قاعده فایروال برای پورت %PORT% ساخته شد.
    )
) else (
    echo    - قاعده فایروال از قبل وجود دارد.
)

echo.
echo [۳/۳] اجرای برنامه ...
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
echo.
echo ================================================================
echo   آدرس‌ها در پایان بالای همین پنجره چاپ می‌شوند.
echo   اطلاعات ورود اولیه: storage\OWNER-CREDENTIALS.txt
echo   برای توقف: Ctrl + C
echo ================================================================
echo.

cd backend
"!PYRUN!" run.py --host !BINDHOST! --port %PORT% --no-browser
if errorlevel 1 (
    echo.
    echo [خطا] برنامه متوقف شد. متن خطای بالا را بررسی کنید.
    pause
)
exit /b 0
