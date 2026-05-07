$bat = @'
@echo off
setlocal

echo ============================================
echo   Star-WebCNC  /  Start All Services
echo ============================================
echo.

if not exist C:\temp mkdir C:\temp

echo [1/4] Cleaning up old processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING" 2^>nul') do taskkill /PID %%a /T /F >nul 2>&1
powershell.exe -NoProfile -Command "Get-Process dotnet -ErrorAction SilentlyContinue | Stop-Process -Force" >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING" 2^>nul') do taskkill /PID %%a /T /F >nul 2>&1
timeout /t 2 /nobreak >nul
echo   Done.
echo.

echo [2/4] Starting Node.js server...
start "StarWebCNC-Server" /min cmd /k "cd /d C:\Star-WebCNC\packages\server && set NODE_ENV=development && npx tsx src/index.ts > C:\temp\server.log 2>&1"
timeout /t 7 /nobreak >nul
netstat -ano | findstr :3000 | findstr LISTENING >nul && echo   :3000 OK || echo   :3000 FAIL - check C:\temp\server.log
echo.

echo [3/4] Starting Agent...
start "StarWebCNC-Agent" /min cmd /k "cd /d C:\Star-WebCNC\packages\agent\StarWebCNC.Agent\publish && set ASPNETCORE_ENVIRONMENT=Production && dotnet StarWebCNC.Agent.dll > C:\temp\agent_prod.log 2>&1"
timeout /t 3 /nobreak >nul
echo   Agent started
echo.

echo [4/4] Starting Vite...
start "StarWebCNC-Vite" /min cmd /k "cd /d C:\Star-WebCNC\packages\web && npx vite --host 0.0.0.0 > C:\temp\vite.log 2>&1"
timeout /t 9 /nobreak >nul
netstat -ano | findstr :5173 | findstr LISTENING >nul && echo   :5173 OK   http://localhost:5173 || echo   :5173 FAIL - check C:\temp\vite.log
echo.

echo ============================================
echo   Open: http://localhost:5173
echo   Logs: C:\temp\server.log  vite.log  agent_prod.log
echo ============================================
pause
'@
[System.IO.File]::WriteAllText('C:\Star-WebCNC\start-all.bat', $bat, [System.Text.Encoding]::Default)
Write-Host 'start-all.bat written OK'
