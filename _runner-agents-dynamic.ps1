# 서버 API에서 활성 설비 목록을 읽어 설비별 에이전트 프로세스를 동적으로 실행

param(
    [string]$ServerUrl = "http://localhost:3000",
    [string]$Username  = "admin",
    [string]$Password  = "admin123!",
    [string]$PublishDir = "C:\Star-WebCNC\packages\agent\StarWebCNC.Agent\publish",
    [string]$LogDir     = "C:\temp"
)

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

Write-Host "[agents] Fetching machine list from $ServerUrl ..."

try {
    $loginBody = "{`"username`":`"$Username`",`"password`":`"$Password`"}"
    $login = Invoke-RestMethod -Uri "$ServerUrl/api/auth/login" -Method POST -ContentType "application/json" -Body $loginBody
    $token = $login.data.accessToken
} catch {
    Write-Host "[agents] ERROR: Server login failed — $_"
    exit 1
}

try {
    $resp = Invoke-RestMethod -Uri "$ServerUrl/api/machines?limit=100" -Headers @{ Authorization = "Bearer $token" }
    $machines = $resp.data.items | Where-Object { $_.isActive -eq $true }
} catch {
    Write-Host "[agents] ERROR: Failed to fetch machines — $_"
    exit 1
}

if ($machines.Count -eq 0) {
    Write-Host "[agents] No active machines found. Nothing to start."
    exit 0
}

Write-Host "[agents] Starting $($machines.Count) agent(s)..."

foreach ($m in $machines) {
    $machineId = $m.machineId
    $ip        = $m.ipAddress
    $port      = if ($m.port) { $m.port } else { 8193 }
    $agentId   = "AGENT-" + $machineId.Replace("MC-", "")
    $logFile   = "$LogDir\agent_$($machineId -replace '-','').log"

    # 호기별 임시 배치 파일 생성 (env 오버라이드 후 dotnet 실행)
    $tempBat = "$env:TEMP\start_agent_$machineId.bat"
    @"
@echo off
set ASPNETCORE_ENVIRONMENT=Production
set Agent__AgentId=$agentId
set Agent__MachineId=$machineId
set Agent__Cnc__IpAddress=$ip
set Agent__Cnc__Port=$port
cd /d $PublishDir
dotnet StarWebCNC.Agent.dll >> $logFile 2>&1
"@ | Out-File -FilePath $tempBat -Encoding ascii

    Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$tempBat`"" -WindowStyle Hidden
    Write-Host "  [$machineId] IP=$ip Port=$port  log=$logFile"
}

Write-Host "[agents] All agents launched."
