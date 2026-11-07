@echo off
rem ============================================================
rem  OCR invoice reader - one-time setup for Windows 10/11 (CPU only)
rem  Double-click this file. It creates .venv, installs packages,
rem  downloads the PP-OCRv5 models and asks for the optional Qwen VLM files.
rem ============================================================
setlocal
cd /d "%~dp0\.."
echo === OCR setup ===

set "PY="
where py >nul 2>nul && set "PY=py -3.11"
if "%PY%"=="" where py >nul 2>nul && set "PY=py -3"
if "%PY%"=="" where python >nul 2>nul && set "PY=python"
if "%PY%"=="" goto no_python

if exist ".venv\Scripts\python.exe" goto venv_ready
echo Creating virtual environment with: %PY%
%PY% -m venv .venv
if errorlevel 1 goto fail
:venv_ready

call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip
pip install -r requirements-server.txt
if errorlevel 1 goto fail

echo.
echo Downloading PP-OCRv5 models from Hugging Face...
python scripts\download_models.py
if errorlevel 1 goto fail
python -m server --models models --check
if errorlevel 1 goto fail

echo.
echo === Optional: handwriting engine (Qwen via llama.cpp) ===
echo Leave a prompt empty to skip the handwriting engine.
set "LLAMA_DIR="
set "MODEL_GGUF="
set "MMPROJ="
set /p "LLAMA_DIR=Folder that contains llama-server.exe: "
set /p "MODEL_GGUF=Full path to the model .gguf file: "
set /p "MMPROJ=Full path to the mmproj-*.gguf file (needed for images): "
(
  echo set "LLAMA_DIR=%LLAMA_DIR%"
  echo set "MODEL_GGUF=%MODEL_GGUF%"
  echo set "MMPROJ=%MMPROJ%"
) > "windows\config.bat"
echo Saved settings to windows\config.bat

echo.
echo === Setup finished. Double-click windows\start.bat to run. ===
pause
exit /b 0

:no_python
echo Python was not found.
echo Install Python 3.11 (64-bit) from https://www.python.org/downloads/
echo and tick "Add python.exe to PATH", then run this file again.
pause
exit /b 1

:fail
echo.
echo Setup stopped because of an error. Read the messages above.
echo If it is a download error, check the internet connection and run this file again.
pause
exit /b 1
