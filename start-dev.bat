@echo off
echo Checking port 5173...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do (
    echo Killing existing process on port 5173 (PID: %%a)
    taskkill /PID %%a /T /F >nul 2>&1
)

timeout /t 3 /nobreak >nul
echo Starting dev server (hidden)...
cscript //nologo "%~dp0start-dev.vbs"
echo Dev server started on http://localhost:5173
echo This window will close automatically.
timeout /t 2 /nobreak >nul
