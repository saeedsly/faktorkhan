@echo off
REM ---------------------------------------------------------------
REM فاکتورخوان — اسکریپت ساخت فایل اجرایی exe برای ویندوز
REM ---------------------------------------------------------------
setlocal
cd /d "%~dp0"

echo ============================================
echo  ساخت فایل اجرایی فاکتورخوان
echo ============================================

:: ۱. بررسیPython
python --version >nul 2>&1
if errorlevel 1 (
    echo خطا: Python نصب نیست. لطفاً ابتدا python.org را باز کنید و Python را نصب کنید.
    pause
    exit /b 1
)

:: ۲. نصب وابستگی‌ها
echo [1/3] نصب وابستگی‌های مورد نیاز...
python -m pip install --upgrade pip >nul 2>&1
python -m pip install -r requirements.txt pyinstaller >nul 2>&1
if errorlevel 1 (
    echo خطا در نصب وابستگی‌ها.
    pause
    exit /b 1
)

:: ۳. ساخت exe با PyInstaller
echo [2/3] اجرا PyInstaller (این stages چند دقیقه طول کشد)...
python -m PyInstaller faktorkhan.spec --clean --noconfirm
if errorlevel 1 (
    echo خطا در ساخت exe.
    pause
    exit /b 1
)

:: ۴. résultat
echo [3/3] اتمام — فایل اجرایی در پوشه dist قرار گرفت:
dir dist\فاکتورخوان.exe >nul 2>&1
if exist "dist\فاکتورخوان.exe" (
    echo   dist\فاکتورخوان.exe
    echo.
    echo این فایل را می‌توانید روی هر سیستم ویندوز (بدون نیاز به Python) اجرا کنید.
) else (
    echo فایل exe ساخته نشد، لاگ‌ها را بررسی کنید.
)

pause
