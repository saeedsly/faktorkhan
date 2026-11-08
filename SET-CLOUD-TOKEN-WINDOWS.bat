@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul 2>&1
title FactorKhan - Cloud OCR Token Setup
set "ROOT=%~dp0"
cd /d "%ROOT%"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

echo.
echo  ============================================================
echo    FactorKhan  -  Cloud OCR token setup
echo    (token is stored encrypted and never displayed)
echo  ============================================================
echo.

set "PY="
if exist "%ROOT%python\python.exe" set "PY=%ROOT%python\python.exe"
if not defined PY if exist "%ROOT%venv\Scripts\python.exe" set "PY=%ROOT%venv\Scripts\python.exe"
if not defined PY (
  where python >nul 2>&1 && set "PY=python"
)
if not defined PY (
  echo  [ERROR] Python not found.
  echo          Run START-WINDOWS.bat first, then try again.
  echo.
  pause
  exit /b 1
)

"%PY%" "%ROOT%tools\set_cloud_token.py" %*
set "CODE=%ERRORLEVEL%"
echo.
if "%CODE%"=="0" (
  echo  Done. Open the app and use the cloud engine on the scan page.
) else if "%CODE%"=="2" (
  echo  No token stored yet. Run this file again and paste the token.
) else if "%CODE%"=="3" (
  echo  Connection failed. Check the token value and your internet connection.
) else (
  echo  Finished with code %CODE%.
)
echo.
pause
exit /b %CODE%
