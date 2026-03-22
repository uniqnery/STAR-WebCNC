#!/usr/bin/env bash
# Star-WebCNC Agent 재배포 스크립트
# 사용법: bash packages/agent/redeploy-agent.sh
# 위치: c:\Star-WebCNC 루트에서 실행

set -e

AGENT_DIR="packages/agent/StarWebCNC.Agent"
PUBLISH_DIR="packages/agent/StarWebCNC.Agent/publish"
DLL_NAME="StarWebCNC.Agent.dll"

echo "=== Star-WebCNC Agent Redeploy ==="
echo ""

# 1. 기존 에이전트 프로세스 종료
echo "[1/3] Stopping existing agent process..."
AGENT_PID=$(powershell.exe -Command "Get-Process -Name 'dotnet' -ErrorAction SilentlyContinue | Where-Object { \$_.CommandLine -like '*StarWebCNC.Agent*' } | Select-Object -First 1 -ExpandProperty Id" 2>/dev/null || true)

if [ -n "$AGENT_PID" ] && [ "$AGENT_PID" != "" ]; then
    echo "  Killing PID $AGENT_PID..."
    powershell.exe -Command "Stop-Process -Id $AGENT_PID -Force -ErrorAction SilentlyContinue" || true
    sleep 2
else
    # fallback: 포트나 DLL명으로 찾기
    powershell.exe -Command "
        \$procs = Get-WmiObject Win32_Process | Where-Object { \$_.CommandLine -like '*StarWebCNC.Agent*' }
        foreach (\$p in \$procs) {
            Write-Host \"  Killing PID \$(\$p.ProcessId)...\"
            Stop-Process -Id \$p.ProcessId -Force -ErrorAction SilentlyContinue
        }
    " 2>/dev/null || true
    sleep 1
fi
echo "  Done."

# 2. 빌드 및 발행
echo "[2/3] Building and publishing..."
cd "$AGENT_DIR"
dotnet publish -c Release -o publish --nologo -v q
cd - > /dev/null
echo "  Published to $PUBLISH_DIR"

# 3. 새 에이전트 시작 (PowerShell ProcessStartInfo — Windows 백그라운드)
echo "[3/3] Starting new agent..."
powershell.exe -Command "
    \$env:ASPNETCORE_ENVIRONMENT = 'Production'
    \$psi = New-Object System.Diagnostics.ProcessStartInfo
    \$psi.FileName = 'dotnet'
    \$psi.Arguments = 'StarWebCNC.Agent.dll'
    \$psi.WorkingDirectory = 'C:\\Star-WebCNC\\packages\\agent\\StarWebCNC.Agent\\publish'
    \$psi.UseShellExecute = \$false
    \$psi.CreateNoWindow = \$false
    \$p = [System.Diagnostics.Process]::Start(\$psi)
    Write-Host \"  Agent started (PID \$(\$p.Id))\"
" 2>/dev/null

sleep 3
echo "  Done."

echo ""
echo "=== Redeploy complete ==="
