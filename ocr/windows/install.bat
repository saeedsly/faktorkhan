@echo off
rem ============================================================
rem  OCR invoice reader - one-time setup for Windows 10/11 (CPU only)
rem  Double-click this file. It creates .venv, installs packages,
rem  downloads the PP-OCRv5 models and asks for the optional Qwen VLM files.
rem ============================================================
setlocal
cd /d "%~dp0\.."
echo === OCR setup ===

rem Each candidate is tested by actually running it; a missing version is skipped.
set "PY="
py -3.11 -V >nul 2>nul
if not errorlevel 1 set "PY=py -3.11"
if defined PY goto have_python
py -3 -V >nul 2>nul
if not errorlevel 1 set "PY=py -3"
if defined PY goto have_python
python -V >nul 2>nul
if not errorlevel 1 set "PY=python"
if defined PY goto have_python
goto no_python
:have_python
echo Using Python: %PY%

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
set "EBOO_TOKEN="
set /p "LLAMA_DIR=Folder that contains llama-server.exe: "
set /p "MODEL_GGUF=Full path to the model .gguf file: "
set /p "MMPROJ=Full path to the mmproj-*.gguf file (needed for images): "
echo Optional: eBoo cloud API token. It is saved only in windows\config.bat (not in Git).
set /p "EBOO_TOKEN=eBoo API token (Enter to skip): "
(
  echo set "LLAMA_DIR=%LLAMA_DIR%"
  echo set "MODEL_GGUF=%MODEL_GGUF%"
  echo set "MMPROJ=%MMPROJ%"
  echo set "EBOO_TOKEN=%EBOO_TOKEN%"
) > "windows\config.bat"
echo Saved settings to windows\config.bat

echo.
echo === Setup finished. Double-click windows\start.bat to run. ===
pause
exit /b 0

:no_python
echo.
echo Python 3.11 was not found on this computer.
echo The Python launcher may exist, but it has no 3.11 installed.
echo.
echo Fix: install Python 3.11 (64-bit) from https://www.python.org/downloads/
echo   - tick "Add python.exe to PATH" on the first screen
echo   - or in a terminal run:  winget install -e --id Python.Python.3.11
echo Then CLOSE this window, open windows\install.bat again.
pause
exit /b 1

:fail
echo.
echo Setup stopped because of an error. Read the messages above.
echo If it is a download error, check the internet connection and run this file again.
pause
exit /b 1
