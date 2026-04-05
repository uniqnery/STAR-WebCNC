@echo off
setlocal

if not exist C:\temp mkdir C:\temp

echo [1/4] Stopping old processes...
powershell.exe -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force" >nul 2>&1
powershell.exe -NoProfile -Command "Get-Process dotnet -ErrorAction SilentlyContinue | Stop-Process -Force" >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/4] Starting server...
cscript //nologo "%~dp0start-server.vbs"
timeout /t 6 /nobreak >nul

echo [3/4] Starting agent...
cscript //nologo "%~dp0start-agent.vbs"
timeout /t 2 /nobreak >nul

echo [4/4] Starting Vite...
cscript //nologo "%~dp0start-dev.vbs"
timeout /t 8 /nobreak >nul

echo.
echo Done! Open: http://localhost:5173
echo Logs: C:\temp\server.log / vite.log / agent_prod.log
echo.
