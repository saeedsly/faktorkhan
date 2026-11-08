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

REM ═════════════════════════════════════════════════════════════════
REM  حالت ۱: نسخهٔ همراه‌بسته — پوشهٔ python کنار همین فایل
REM  در این حالت نه پایتون سیستم لازم است، نه اینترنت، نه pip.
REM ═════════════════════════════════════════════════════════════════
if exist "python\python.exe" (
    for /f "tokens=2" %%v in ('python\python.exe --version 2^>^&1') do set "PYVER=%%v"
    echo [۱/۴] پایتون همراه بسته: نسخه !PYVER!
    echo [۲/۴] محیط اجرا همراه بسته است ^(نیازی به نصب نیست^).
    if exist "python\Lib\site-packages\fastapi\" (
        echo [۳/۴] کتابخانه‌ها آماده هستند.
    ) else (
        echo [۳/۴] نصب آفلاین کتابخانه‌ها از پوشه wheels ...
        python\python.exe tools\install_offline.py --wheels wheels --site "python\Lib\site-packages" > install-log.txt 2>&1
        if errorlevel 1 goto :errbundle
        echo [۳/۴] کتابخانه‌ها نصب شدند.
    )
    set "PYRUN=%~dp0python\python.exe"
    goto :stage4
)

REM ═════════════════════════════════════════════════════════════════
REM  حالت ۲: پایتون سیستم + محیط اجرا (venv)
REM ═════════════════════════════════════════════════════════════════
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
echo [۱/۴] پایتون سیستم: نسخه !PYVER!

REM مسیر مطلق مفسر پایتون سیستم
for /f "delims=" %%p in ('%PYCMD% -c "import sys;print(sys.executable)" 2^>nul') do set "SYSEXE=%%p"

REM آیا پایتون سیستم خودش همهٔ کتابخانه‌ها را دارد؟ (نصب دستی با pip)
set "SYSOK="
if defined SYSEXE (
    "!SYSEXE!" -c "import fastapi, uvicorn, sqlalchemy, cryptography, pymysql, openpyxl, pypdf, httpx" >nul 2>&1
    if not errorlevel 1 set "SYSOK=1"
)

REM آیا محیط اجرا (venv) سالم و کامل داریم؟
set "VENVOK="
if exist "venv\Scripts\python.exe" (
    venv\Scripts\python.exe -c "import fastapi, uvicorn, sqlalchemy, cryptography, pymysql, openpyxl, pypdf, httpx" >nul 2>&1
    if not errorlevel 1 set "VENVOK=1"
)

if defined VENVOK (
    echo [۲/۴] محیط اجرا ^(venv^) آماده است.
    echo [۳/۴] کتابخانه‌ها آماده هستند.
    set "PYRUN=%~dp0venv\Scripts\python.exe"
    goto :stage4
)

if defined SYSOK (
    echo [۲/۴] کتابخانه‌ها روی پایتون سیستم نصب هستند ^(بدون venv اجرا می‌شود^).
    echo [۳/۴] کتابخانه‌ها آماده هستند.
    set "PYRUN=!SYSEXE!"
    goto :stage4
)

if not exist "venv\Scripts\python.exe" (
    echo [۲/۴] ساخت محیط اجرا ^(یک‌بار انجام می‌شود، حدود ۳۰ ثانیه^) ...
    %PYCMD% -m venv venv
    if errorlevel 1 goto :errvenv
) else (
    echo [۲/۴] محیط اجرا موجود است.
)

set "PIPOK="
if exist "venv\.installed" (
    venv\Scripts\python.exe -c "import fastapi, uvicorn, sqlalchemy, cryptography" >nul 2>&1
    if not errorlevel 1 set "PIPOK=1"
)
if defined PIPOK echo [۳/۴] کتابخانه‌ها از قبل نصب هستند.

REM ۳-الف: نصب آفلاین از پوشه wheels (بدون اینترنت)
if not defined PIPOK if exist "wheels\" (
    echo [۳/۴] نصب آفلاین کتابخانه‌ها از پوشه wheels  ^(بدون نیاز به اینترنت^) ...
    venv\Scripts\python.exe -m pip install --no-index --find-links wheels -r backend\requirements.txt --disable-pip-version-check > install-log.txt 2>&1
    if not errorlevel 1 set "PIPOK=1"
)

REM ۳-ب: نصب آنلاین با چند منبع (اگر اینترنت در دسترس باشد)
if not defined PIPOK (
    echo [۳/۴] نصب کتابخانه‌ها از اینترنت  ^(یک‌بار^) ...
    echo. > install-log.txt
    for %%M in ("https://pypi.org/simple" "https://mirror-pypi.runflare.com/simple" "https://pypi.tuna.tsinghua.edu.cn/simple" "https://mirrors.aliyun.com/pypi/simple" "https://mirrors.cloud.tencent.com/pypi/simple") do (
        if not defined PIPOK (
            echo       تلاش با %%M ...
            venv\Scripts\python.exe -m pip install -r backend\requirements.txt -i %%M --timeout 60 --retries 1 --prefer-binary --disable-pip-version-check >> install-log.txt 2>&1
            if not errorlevel 1 set "PIPOK=1"
        )
    )
)

if not defined PIPOK goto :errpip
venv\Scripts\python.exe -c "import fastapi, uvicorn, sqlalchemy, cryptography, pymysql, openpyxl, pypdf, httpx" >nul 2>&1
if errorlevel 1 goto :errpip
echo ok> "venv\.installed"
echo [۳/۴] کتابخانه‌ها آماده هستند.
if exist "install-log.txt" del /q "install-log.txt" >nul 2>&1
set "PYRUN=%~dp0venv\Scripts\python.exe"

:stage4
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

set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
cd backend
"!PYRUN!" run.py --host 127.0.0.1 --port 8000
if errorlevel 1 (
    echo.
    echo [خطا] برنامه متوقف شد. متن خطای بالا را بررسی کنید.
    echo        اگر پیام «address already in use» بود، یعنی برنامه از قبل باز است
    echo        و کافی است نشانی http://127.0.0.1:8000 را در مرورگر باز کنید.
    pause
)
exit /b 0

:errbundle
echo.
echo [خطا] نصب آفلاین کتابخانه‌ها از پوشه wheels ناموفق بود.
echo   متن خطا در فایل install-log.txt ذخیره شد.
echo   معمولاً یعنی پوشه wheels ناقص کپی شده است؛ فایل زیپ بسته ویندوز را
echo   کامل و دوباره از حالت فشرده خارج کنید.
echo.
pause
exit /b 1

:nopython
echo [خطا] نه پایتون سیستم پیدا شد، نه پوشه python همراه بسته.
echo.
echo   ۱. اگر بسته کامل ویندوز ^(فایل PORTABLE^) را دارید، آن را کامل
echo      از حالت فشرده خارج کنید تا پوشه python ساخته شود.
echo   ۲. یا پایتون 3.12 / 3.13 / 3.14 را از python.org نصب کنید و در
echo      صفحه اول نصب، تیک «Add python.exe to PATH» را بزنید.
echo.
pause
exit /b 1

:errvenv
echo.
echo [خطا] ساخت محیط اجرا ناموفق بود.
echo   • مطمئن شوید پایتون کامل نصب شده است ^(نسخه 3.12 یا بالاتر^).
echo   • پوشه پروژه را در مسیری بدون فاصله و بدون حروف غیرانگلیسی بگذارید، مثل C:\faktorkhan
echo.
pause
exit /b 1

:errpip
echo.
echo ================================================================
echo [خطا] نصب کتابخانه‌ها ناموفق بود — اینترنت به pypi.org نرسید.
echo ================================================================
echo.
echo   راه حل قطعی ^(بدون اینترنت و بدون پایتون^):
echo     ۱. فایل بسته کامل ویندوز ^(PORTABLE^) را دانلود کنید.
echo     ۲. آن را در همان مسیر پروژه ^(مثلا C:\^) کامل از حالت فشرده خارج کنید.
echo        پوشه های python و wheels کنار همین فایل ساخته می‌شوند.
echo     ۳. دوباره روی START-WINDOWS.bat دوبار کلیک کنید.
echo.
echo   راه حل دوم ^(اینترنت با پروکسی^):
echo     set HTTP_PROXY=http://proxy:port
echo     set HTTPS_PROXY=http://proxy:port
echo     سپس دوباره این فایل را اجرا کنید.
echo.
echo   راه حل سوم ^(منبع داخلی / آینه^):
echo     venv\Scripts\python.exe -m pip install -r backend\requirements.txt
echo        -i https://mirror-pypi.runflare.com/simple --timeout 60
echo.
if exist "install-log.txt" (
    echo   فایل install-log.txt برای بررسی ساخته شد ^(می‌توانید برای پشتیبانی بفرستید^).
    echo.
)
pause
exit /b 1
