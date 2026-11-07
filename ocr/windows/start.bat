@echo off
rem ============================================================
rem  Starts the OCR server (and the optional Qwen handwriting engine),
rem  then opens the page in the browser. Run windows\install.bat first.
rem ============================================================
setlocal
cd /d "%~dp0\.."

if not exist ".venv\Scripts\activate.bat" (
  echo Setup has not been run yet. Double-click windows\install.bat first.
  pause
  exit /b 1
)

set "LLAMA_DIR="
set "MODEL_GGUF="
set "MMPROJ="
if exist "windows\config.bat" call "windows\config.bat"
call ".venv\Scripts\activate.bat"

set "VLM_ARG="
if not "%LLAMA_DIR%"=="" if not "%MODEL_GGUF%"=="" if not "%MMPROJ%"=="" (
  if exist "%LLAMA_DIR%\llama-server.exe" (
    echo Starting Qwen handwriting engine in a new window...
    start "llama-server (Qwen)" cmd /k ""%LLAMA_DIR%\llama-server.exe" -m "%MODEL_GGUF%" --mmproj "%MMPROJ%" --host 127.0.0.1 --port 8080 -c 8192"
    set "VLM_ARG=--vlm-url http://127.0.0.1:8080"
    echo Waiting 30 seconds for the model to load...
    timeout /t 30 >nul
  ) else (
    echo llama-server.exe was not found in %LLAMA_DIR%. Starting without the handwriting engine.
  )
)

echo Starting OCR server in a new window...
start "OCR server" cmd /k "python -m server --models models --port 8000 %VLM_ARG%"
timeout /t 6 >nul
start "" "http://localhost:8000"
echo Done. Close the two server windows to stop.
exit /b 0
