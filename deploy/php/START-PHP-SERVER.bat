@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul 2>&1
title FactorKhan - PHP built-in server
cd /d "%~dp0"
set "PYTHONUTF8=1"

echo.
echo  ============================================================
echo    FactorKhan - PHP server (no Apache / no WAMP needed)
echo  ============================================================
echo.

REM ── پیدا کردن php.exe ───────────────────────────────────────────
set "PHP="
if exist "%~dp0php\php.exe" set "PHP=%~dp0php\php.exe"

if not defined PHP (
  where php >nul 2>&1 && set "PHP=php"
)

if not defined PHP (
  echo  Searching for PHP inside WAMP / XAMPP ...
  for /d %%D in ("C:\wamp64\bin\php\php*") do if exist "%%D\php.exe" set "PHP=%%D\php.exe"
  if not defined PHP for /d %%D in ("C:\wamp\bin\php\php*") do if exist "%%D\php.exe" set "PHP=%%D\php.exe"
  if not defined PHP for /d %%D in ("C:\xampp\php") do if exist "%%D\php.exe" set "PHP=%%D\php.exe"
)

if not defined PHP (
  echo  [ERROR] php.exe not found.
  echo.
  echo   Do one of these:
  echo     1^) Install WAMP/XAMPP and run this file again
  echo     2^) Copy the full path of php.exe into this file:
  echo        set "PHP=C:\path\to\php.exe"
  echo.
  pause
  exit /b 1
)

echo  PHP: %PHP%
echo.

REM ── بررسی نسخه و افزونه‌های لازم ────────────────────────────────
"%PHP%" -r "echo '  Version: ' . PHP_VERSION . PHP_EOL; echo '  curl: ' . (function_exists('curl_init') ? 'OK' : 'MISSING - enable extension=curl in php.ini') . PHP_EOL;"
echo.

REM ── پورت آزاد ───────────────────────────────────────────────────
set "PORT=8080"
"%PHP%" -r "$p=8080; while(@fsockopen('127.0.0.1',$p,$e,$s,0.2)){$p++;} echo $p;" > "%TEMP%\fk_port.txt" 2>nul
set /p PORT=<"%TEMP%\fk_port.txt"
if not defined PORT set "PORT=8080"
del "%TEMP%\fk_port.txt" >nul 2>&1

echo  ============================================================
echo    Open this address in your browser:
echo.
echo         http://127.0.0.1:%PORT%/
echo.
echo    (do NOT use https:// and do NOT use localhost with HTTPS)
echo    Press Ctrl+C in this window to stop the server.
echo  ============================================================
echo.

start "" "http://127.0.0.1:%PORT%/"

"%PHP%" -d upload_max_filesize=25M -d post_max_size=27M -d max_execution_time=300 ^
        -d display_errors=1 -d error_reporting=E_ALL ^
        -S 127.0.0.1:%PORT% -t . server.php

echo.
echo  Server stopped.
pause
