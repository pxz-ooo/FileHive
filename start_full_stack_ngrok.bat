@echo off
setlocal

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"

set "BACKEND_PORT=8000"
set "FRONTEND_PORT=5173"
set "HOST=0.0.0.0"
set "NGROK_API_BASE=https://oxford-doorpost-naming.ngrok-free.dev"

set "PYTHON_EXE=D:\env\anaconda3\envs\llm\python.exe"
set "FRONTEND_DIR=%ROOT_DIR%\frontend"
set "VITE_CMD=%FRONTEND_DIR%\node_modules\.bin\vite.cmd"

echo.
echo [FileHive] Starting backend and frontend in NGROK direct mode...

call :kill_port %BACKEND_PORT%
call :kill_port %FRONTEND_PORT%

timeout /t 2 /nobreak >nul

if not exist "%PYTHON_EXE%" (
  echo [FileHive] python not found:
  echo %PYTHON_EXE%
  pause
  exit /b 1
)

if not exist "%VITE_CMD%" (
  echo [FileHive] vite not found:
  echo %VITE_CMD%
  echo [FileHive] Please run npm install in %FRONTEND_DIR%
  pause
  exit /b 1
)

echo [FileHive] Starting backend window...
start "FileHive Backend (Ngrok)" cmd /k "cd /d ""%ROOT_DIR%"" && set PYTHONPATH=%ROOT_DIR% && ""%PYTHON_EXE%"" -m uvicorn app.main:app --host %HOST% --port %BACKEND_PORT% --reload"

echo [FileHive] Starting frontend window...
start "FileHive Frontend (Ngrok)" cmd /k "cd /d ""%FRONTEND_DIR%"" && set VITE_API_BASE_URL=%NGROK_API_BASE% && ""%VITE_CMD%"" --host %HOST% --port %FRONTEND_PORT%"

echo.
echo [FileHive] Backend(local):   http://127.0.0.1:%BACKEND_PORT%/health
echo [FileHive] Frontend(local):  http://127.0.0.1:%FRONTEND_PORT%
echo [FileHive] Frontend API base: %NGROK_API_BASE%
echo [FileHive] Update NGROK_API_BASE in this file when the ngrok domain changes.
echo.
pause
exit /b 0

:kill_port
set "TARGET_PORT=%~1"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%TARGET_PORT% .*LISTENING"') do (
  echo [FileHive] Stopping process %%P using port %TARGET_PORT%...
  taskkill /PID %%P /F >nul 2>&1
)
exit /b 0
