@echo off
setlocal

if not exist C:\temp mkdir C:\temp

echo [1/4] Stopping old processes...
powershell.exe -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force" >nul 2>&1
powershell.exe -NoProfile -Command "Get-Process dotnet -ErrorAction SilentlyContinue | Stop-Process -Force" >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/4] Starting server...
cscript //nologo "%~dp0start-server.vbs"

echo [wait] Waiting for server health...
set "SERVER_READY="
for /L %%I in (1,1,60) do (
    powershell.exe -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/health' -TimeoutSec 1; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>&1
    if not errorlevel 1 (
        set "SERVER_READY=1"
        goto server_ready
    )
    timeout /t 1 /nobreak >nul
)

echo [ERROR] Server did not become ready within 60 seconds.
echo Check log: C:\temp\server.log
goto start_vite

:server_ready
echo [wait] Server is ready.

echo [3/4] Starting agents (dynamic)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0_runner-agents-dynamic.ps1"
timeout /t 2 /nobreak >nul

:start_vite
echo [4/4] Starting Vite...
cscript //nologo "%~dp0start-dev.vbs"
timeout /t 8 /nobreak >nul

echo.
echo Done! Open: http://localhost:5173
echo Logs: C:\temp\server.log / vite.log / agent_MC001.log / agent_MC002.log ...
echo.
