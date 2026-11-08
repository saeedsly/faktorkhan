@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title فاکتورخوان — ساخت بسته کتابخانه‌های آفلاین (wheels)
cd /d "%~dp0.."

echo ================================================================
echo   ساخت پوشه wheels برای نصب آفلاین روی ویندوز
echo   (این کار فقط یک‌بار و روی کامپیوتری با اینترنت سالم انجام می‌شود)
echo ================================================================
echo.

set "PYCMD=python"
where python >nul 2>&1
if errorlevel 1 (
    where py >nul 2>&1
    if errorlevel 1 (
        echo [خطا] پایتون پیدا نشد. اول پایتون 3.12 یا بالاتر را نصب کنید.
        pause & exit /b 1
    )
    set "PYCMD=py -3"
)

if not exist "wheels" mkdir wheels

REM ── نسخه‌های پایتون مقصد (همان‌هایی که بسته آفلاین پوشش می‌دهد) ──
for %%P in (3.12 3.13 3.14) do (
    echo [نسخه %%P] دانلود کتابخانه‌های ویندوزی ...
    %PYCMD% -m pip download --no-deps --only-binary=:all: --platform win_amd64 --implementation cp --python-version %%P -r backend\requirements.lock.txt -d wheels --disable-pip-version-check
    if errorlevel 1 (
        echo.
        echo [خطا] دانلود برای نسخه %%P ناموفق بود. اینترنت/آینه را بررسی کنید.
        echo        می‌توانید با آینه داخلی امتحان کنید:
        echo        %PYCMD% -m pip download ... -i https://mirror-pypi.runflare.com/simple
        pause & exit /b 1
    )
)

echo.
echo ================================================================
echo   تمام شد. تعداد فایل‌های داخل wheels:
dir /b wheels\*.whl | find /c /v "" 
echo.
echo   حالا فایل START-WINDOWS.bat را اجرا کنید؛ کتابخانه‌ها
echo   بدون نیاز به اینترنت از همین پوشه نصب می‌شوند.
echo ================================================================
pause
