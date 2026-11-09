@echo off
chcp 65001 >nul
setlocal
title فاکتورخوان — بررسی سلامت اجرا
cd /d "%~dp0.."

set "REPORT=diagnose-report.txt"
echo ================================================================ > "%REPORT%"
echo   گزارش بررسی فاکتورخوان >> "%REPORT%"
echo ================================================================ >> "%REPORT%"
echo. >> "%REPORT%"

if exist "python\python.exe" (
    set "PYRUN=%~dp0..\python\python.exe"
    echo حالت: همراه بسته ^(python داخل پروژه^)
) else (
    if exist "venv\Scripts\python.exe" (
        set "PYRUN=%~dp0..\venv\Scripts\python.exe"
        echo حالت: محیط اجرا venv
    ) else (
        set "PYRUN=python"
        echo حالت: پایتون سیستم
    )
)

echo. ---------------------------------------------------------------
"%PYRUN%" --version
"%PYRUN%" -c "import sys; print('exe:', sys.executable); print('version:', sys.version)"
echo.
echo. بررسی کتابخانه‌ها:
"%PYRUN%" -c "import fastapi, uvicorn, starlette, pydantic; print('  web  ok', fastapi.__version__)"
"%PYRUN%" -c "import sqlalchemy; print('  db   ok', sqlalchemy.__version__)"
"%PYRUN%" -c "import cryptography; print('  crypto ok', cryptography.__version__)"
"%PYRUN%" -c "import jwt, cryptography, multipart, httpx, openpyxl, pypdf; print('  misc ok')"

echo. >> "%REPORT%"
"%PYRUN%" -c "import sys; print('exe:', sys.executable); print('version:', sys.version)" >> "%REPORT%" 2>&1
"%PYRUN%" -c "import fastapi, uvicorn, sqlalchemy, cryptography, pymysql, openpyxl, pypdf, httpx; print('all imports ok')" >> "%REPORT%" 2>&1
echo. >> "%REPORT%"
echo مسیرها: >> "%REPORT%"
echo   storage: >> "%REPORT%"
dir /b storage 2>nul >> "%REPORT%"

echo.
echo ================================================================
echo  اگر همه ردیف‌ها ok بود، برنامه سالم است.
echo  این متن ^(و فایل %REPORT%^) را می‌توانید برای پشتیبانی بفرستید.
echo ================================================================
pause
