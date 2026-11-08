@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title فاکتورخوان — راه‌اندازی MySQL (WAMP / XAMPP)
cd /d "%~dp0"

echo ================================================================
echo    فاکتورخوان — راه‌اندازی پایگاه داده MySQL
echo ================================================================
echo.
echo  پیش‌نیاز: WAMP یا XAMPP نصب و MySQL آن روشن باشد ^(آیکن سبز^).
echo  اگر MySQL را جداگانه نصب کرده‌اید، همان را روشن کنید.
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
    echo [خطا] پایتون پیدا نشد. اول START-WINDOWS.bat را اجرا کنید یا پایتون نصب کنید.
    pause
    exit /b 1
)

"%PYRUN%" -c "import pymysql" >nul 2>&1
if errorlevel 1 (
    echo [خطا] کتابخانه PyMySQL در دسترس نیست.
    echo        اول START-WINDOWS.bat را یک‌بار اجرا کنید تا کتابخانه‌ها نصب شوند.
    pause
    exit /b 1
)

"%PYRUN%" tools\setup_mysql.py --interactive
set "RC=!errorlevel!"

echo.
if "!RC!"=="0" (
    echo ================================================================
    echo   پایگاه داده آماده شد.
    echo   حالا فایل START-SERVER-WINDOWS.bat را اجرا کنید.
    echo ================================================================
) else (
    echo ================================================================
    echo   راه‌اندازی کامل نشد ^(کد !RC!^). موارد بالا را بررسی کنید:
    echo     • MySQL روشن است؟
    echo     • گذرواژه root درست است؟ ^(در WAMP معمولاً خالی است^)
    echo     • پورت 3306 آزاد است؟
    echo   می‌توانید دوباره همین فایل را اجرا کنید.
    echo ================================================================
)
echo.
pause
