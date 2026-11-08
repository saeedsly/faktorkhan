@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title فاکتورخوان — راه‌اندازی پایگاه داده MySQL روی ویندوز
cd /d "%~dp0.."

echo ================================================================
echo   فاکتورخوان — راه‌اندازی MySQL / MariaDB روی ویندوز
echo   (سازگار با WAMP، XAMPP، MySQL Community و MariaDB)
echo ================================================================
echo.
echo  این اسکریپت:
echo    ۱) پایگاه داده و کاربر مخصوص برنامه را می‌سازد
echo    ۲) فایل .env را با کلیدهای امنیتی تصادفی می‌نویسد
echo    ۳) برنامه را به MySQL وصل می‌کند
echo.
echo  داده‌های موجود شما پاک نمی‌شود (اگر جدول‌ها از قبل باشند،
echo  برنامه خودش از آن‌ها استفاده می‌کند).
echo.
pause

REM ── پیدا کردن mysql.exe ──────────────────────────────────────────
set "MYSQL="
where mysql >nul 2>&1
if not errorlevel 1 set "MYSQL=mysql"

if not defined MYSQL (
    for %%D in ("C:\wamp64\bin\mysql" "C:\wamp\bin\mysql" "C:\xampp\mysql\bin" "C:\laragon\bin\mysql") do (
        if not defined MYSQL if exist "%%~D\*" (
            for /d %%V in ("%%~D\*") do (
                if not defined MYSQL if exist "%%~V\bin\mysql.exe" set "MYSQL=%%~V\bin\mysql.exe"
            )
            if not defined MYSQL if exist "%%~D\mysql.exe" set "MYSQL=%%~D\mysql.exe"
        )
    )
)
if not defined MYSQL (
    for /d %%D in ("C:\Program Files\MySQL\MySQL Server*" "C:\Program Files\MariaDB*") do (
        if not defined MYSQL if exist "%%~D\bin\mysql.exe" set "MYSQL=%%~D\bin\mysql.exe"
    )
)

if not defined MYSQL (
    echo [خطا] فایل mysql.exe پیدا نشد.
    echo.
    echo   • اگر WAMP دارید، مطمئن شوید نصب و یک‌بار اجرا شده است.
    echo   • یا مسیر mysql.exe را دستی در این خط بگذارید و دوباره اجرا کنید.
    echo.
    pause
    exit /b 1
)
echo [۱/۵] کلاینت MySQL پیدا شد:
echo        !MYSQL!
echo.

REM ── پرسش‌ها ──────────────────────────────────────────────────────
set "DBHOST=127.0.0.1"
set /p DBHOST_IN=آدرس سرور MySQL [پیش‌فرض 127.0.0.1]: 
if not "!DBHOST_IN!"=="" set "DBHOST=!DBHOST_IN!"

set "DBPORT=3306"
set /p DBPORT_IN=پورت MySQL [پیش‌فرض 3306]: 
if not "!DBPORT_IN!"=="" set "DBPORT=!DBPORT_IN!"

set "ROOTUSER=root"
set /p ROOTUSER_IN=نام کاربری مدیر MySQL [پیش‌فرض root]: 
if not "!ROOTUSER_IN!"=="" set "ROOTUSER=!ROOTUSER_IN!"

echo.
echo گذرواژهٔ مدیر MySQL را وارد کنید (اگر خالی است فقط Enter بزنید):
set /p ROOTPASS=گذرواژهٔ مدیر: 

set "DBNAME=faktorkhan"
set /p DBNAME_IN=نام پایگاه داده [پیش‌فرض faktorkhan]: 
if not "!DBNAME_IN!"=="" set "DBNAME=!DBNAME_IN!"

set "DBUSER=faktorkhan"
set /p DBUSER_IN=نام کاربر برنامه [پیش‌فرض faktorkhan]: 
if not "!DBUSER_IN!"=="" set "DBUSER=!DBUSER_IN!"

REM ── ساخت کاربر و پایگاه ─────────────────────────────────────────
set "PYGEN=python"
if exist "python\python.exe" set "PYGEN=python\python.exe"
for /f "delims=" %%p in ('!PYGEN! tools\genpass.py 2^>nul') do set "DBPASS=%%p"
if not defined DBPASS (
    echo [خطا] ساخت گذرواژهٔ تصادفی ناموفق بود (پایتون پیدا نشد).
    echo        ابتدا START-WINDOWS.bat را یک‌بار اجرا کنید یا پایتون نصب کنید.
    pause
    exit /b 1
)

set "CNF=%TEMP%\fk-my-%RANDOM%.cnf"
> "!CNF!" echo [client]
>> "!CNF!" echo user=!ROOTUSER!
>> "!CNF!" echo password=!ROOTPASS!
>> "!CNF!" echo host=!DBHOST!
>> "!CNF!" echo port=!DBPORT!

echo.
echo [۲/۵] بررسی اتصال به MySQL ...
"!MYSQL!" --defaults-extra-file="!CNF!" -e "SELECT VERSION();" >nul 2>&1
if errorlevel 1 (
    echo [خطا] اتصال به MySQL برقرار نشد.
    echo        نام کاربری/گذرواژهٔ مدیر و روشن بودن سرویس MySQL را بررسی کنید.
    del /q "!CNF!" >nul 2>&1
    pause
    exit /b 1
)

echo [۳/۵] ساخت پایگاه داده و کاربر ...
set "SQL=CREATE DATABASE IF NOT EXISTS `!DBNAME!` CHARACTER SET utf8mb4 COLLATE utf8mb4_persian_ci; CREATE USER IF NOT EXISTS '!DBUSER!'@'localhost' IDENTIFIED BY '!DBPASS!'; CREATE USER IF NOT EXISTS '!DBUSER!'@'127.0.0.1' IDENTIFIED BY '!DBPASS!'; ALTER USER '!DBUSER!'@'localhost' IDENTIFIED BY '!DBPASS!'; ALTER USER '!DBUSER!'@'127.0.0.1' IDENTIFIED BY '!DBPASS!'; GRANT ALL PRIVILEGES ON `!DBNAME!`.* TO '!DBUSER!'@'localhost'; GRANT ALL PRIVILEGES ON `!DBNAME!`.* TO '!DBUSER!'@'127.0.0.1'; FLUSH PRIVILEGES;"

"!MYSQL!" --defaults-extra-file="!CNF!" -e "!SQL!"
if errorlevel 1 (
    echo [خطا] ساخت پایگاه داده یا کاربر ناموفق بود.
    echo        اگر نسخهٔ MySQL قدیمی است، دستور را دستی اجرا کنید (راهنما: docs\DEPLOY-WINDOWS-WAMP.md).
    del /q "!CNF!" >nul 2>&1
    pause
    exit /b 1
)
del /q "!CNF!" >nul 2>&1
echo        پایگاه !DBNAME! و کاربر !DBUSER! آماده شد.
echo.

REM ── نوشتن .env ──────────────────────────────────────────────────
set "PYENV=python"
if exist "python\python.exe" set "PYENV=python\python.exe"

echo [۴/۵] نوشتن فایل تنظیمات .env ...
set "CONN=mysql+pymysql://!DBUSER!:!DBPASS!@!DBHOST!:!DBPORT!/!DBNAME!?charset=utf8mb4"
"!PYENV!" tools\make_env.py --gen-secrets --set "DATABASE_URL=!CONN!" --set "APP_ENV=production" --set "TRUST_PROXY=1" --set "CORS_ORIGINS=*" --set "ALLOWED_HOSTS=localhost,127.0.0.1" --quiet
if errorlevel 1 (
    echo [خطا] نوشتن .env ناموفق بود. (پایتون در دسترس است؟)
    pause
    exit /b 1
)
echo        .env ساخته شد.
echo.

REM ── تست نهایی با خود برنامه ─────────────────────────────────────
echo [۵/۵] تست اتصال برنامه به MySQL ...
"!PYENV!" -c "import sys; sys.path.insert(0,'backend'); from app.database import init_db; init_db(); print('اتصال و ساخت جداول: موفق')"
if errorlevel 1 (
    echo.
    echo [هشدار] برنامه نتوانست به MySQL وصل شود.
    echo         فایل .env را بررسی کنید و برای دیدن خطای دقیق، START-WINDOWS.bat را اجرا کنید.
    echo         (اگر ماژول pymysql نصب نیست: python -m pip install -r backend\requirements.txt)
    pause
    exit /b 1
)

echo.
echo ================================================================
echo   تمام شد ✓  برنامه الان روی MySQL کار می‌کند.
echo.
echo   اجرا:  START-WINDOWS.bat
echo   ورود:  http://127.0.0.1:8000
echo.
echo   پایگاه داده: !DBNAME!   کاربر: !DBUSER!
echo   گذرواژهٔ کاربر پایگاه در فایل .env ذخیره شده است.
echo.
echo   اگر می‌خواهید از اینترنت در دسترس باشد، حتماً
echo   docs\SECURITY-FA.md را بخوانید (HTTPS، ALLOWED_HOSTS و …).
echo ================================================================
echo.
pause
