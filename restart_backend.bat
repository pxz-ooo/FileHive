@echo off
setlocal

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"

set "PORT=8000"
set "PYTHON_EXE=D:\env\anaconda3\envs\llm\python.exe"
set "HOST=0.0.0.0"

echo.
echo [FileHive] Restarting backend on port %PORT%...

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  echo [FileHive] Stopping process %%P using port %PORT%...
  taskkill /PID %%P /F >nul 2>&1
)

timeout /t 2 /nobreak >nul

if not exist "%PYTHON_EXE%" (
  echo [FileHive] python not found:
  echo %PYTHON_EXE%
  pause
  exit /b 1
)

echo [FileHive] Starting uvicorn...
start "FileHive Backend" cmd /k "cd /d ""%ROOT_DIR%"" && set PYTHONPATH=%ROOT_DIR% && ""%PYTHON_EXE%"" -m uvicorn app.main:app --host %HOST% --port %PORT% --reload"

echo [FileHive] Backend restart command sent.
echo [FileHive] Open http://192.168.9.207:%PORT%/health to verify.
echo.
pause
