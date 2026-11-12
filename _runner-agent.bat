@echo off
setlocal
set "AGENT_LOG_DIR=%~dp0agent-runtime"
if not exist "%AGENT_LOG_DIR%" mkdir "%AGENT_LOG_DIR%"
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0_runner-agents-dynamic.ps1" -TargetMachineId MC-002 >> "%AGENT_LOG_DIR%\agent_start.log" 2>&1
exit /b %errorlevel%
