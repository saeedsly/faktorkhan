@echo off
chcp 65001 >nul
title ساخت نسخه ویندوزی فاکتورخوان
echo ================================================================
echo   فاکتورخوان — ساخت نسخه نصبی ویندوز
echo   اثر: سعید سالاری
echo ================================================================
echo.

cd /d "%~dp0"

if not exist ".venv" (
    echo [1/4] ساخت محیط مجازی ...
    python -m venv .venv || goto :err
)

echo [2/4] نصب وابستگی ها ...
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip >nul
pip install -r ..\backend\requirements.txt pyinstaller pywebview || goto :err

echo [3/4] ساخت فایل اجرایی ...
pyinstaller faktorkhan.spec --noconfirm --clean || goto :err

echo.
echo [4/4] فایل اجرایی آماده است: desktop\dist\FactorKhan\FactorKhan.exe
echo.
where ISCC >nul 2>&1
if %errorlevel%==0 (
    echo ساخت نصب کننده با Inno Setup ...
    ISCC installer\faktorkhan.iss
    echo نصب کننده در پوشه desktop\dist-installer ساخته شد.
) else (
    echo [راهنما] برای ساخت فایل Setup، Inno Setup 6 را از jrsoftware.org نصب کنید
    echo          سپس این دستور را اجرا کنید:  ISCC installer\faktorkhan.iss
)
echo.
pause
exit /b 0

:err
echo.
echo خطا در فرآیند ساخت. پیام بالا را بررسی کنید.
pause
exit /b 1
