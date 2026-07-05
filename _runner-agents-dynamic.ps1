param(
    [string]$ServerUrl  = "http://localhost:3000",
    [string]$Username   = "admin",
    [string]$Password   = "admin123!",
    [string]$PublishDir = "C:\Star-WebCNC\packages\agent\StarWebCNC.Agent\publish",
    [string]$LogDir     = "C:\Star-WebCNC\agent-runtime"
)

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

Write-Host "[agents] Fetching machine list from $ServerUrl ..."

try {
    $loginBody = "{`"username`":`"$Username`",`"password`":`"$Password`"}"
    $login = Invoke-RestMethod -Uri "$ServerUrl/api/auth/login" -Method POST -ContentType "application/json" -Body $loginBody
    $token = $login.data.accessToken
} catch {
    Write-Host "[agents] ERROR: Server login failed - $_"
    exit 1
}

try {
    $resp = Invoke-RestMethod -Uri "$ServerUrl/api/machines?limit=100" -Headers @{ Authorization = "Bearer $token" }
    $machines = $resp.data.items | Where-Object { $_.isActive -eq $true }
} catch {
    Write-Host "[agents] ERROR: Failed to fetch machines - $_"
    exit 1
}

if ($machines.Count -eq 0) {
    Write-Host "[agents] No active machines found. Nothing to start."
    exit 0
}

Write-Host "[agents] Starting $($machines.Count) agent(s)..."

$dotnet = "C:\Program Files\dotnet\dotnet.exe"

foreach ($m in $machines) {
    $machineId = $m.machineId
    $ip        = $m.ipAddress
    $port      = if ($m.port) { $m.port } else { 8193 }
    $agentId   = "AGENT-" + $machineId.Replace("MC-", "")
    $templateId = if ($m.templateId) { $m.templateId } elseif ($m.template -and $m.template.templateId) { $m.template.templateId } else { "" }
    $safeMachineId = $machineId -replace '-', ''
    $logFile   = Join-Path $LogDir "agent_$safeMachineId.log"
    $psScript  = Join-Path $LogDir "start_agent_$machineId.ps1"

    @"
`$env:ASPNETCORE_ENVIRONMENT = 'Production'
`$env:DOTNET_ENVIRONMENT = 'Production'
`$env:Logging__EventLog__LogLevel__Default = 'None'
`$env:Logging__EventLog__LogLevel__StarWebCNC_Agent = 'None'
`$env:Agent__AgentId = '$agentId'
`$env:Agent__MachineId = '$machineId'
`$env:Agent__TemplateId = '$templateId'
`$env:Agent__Cnc__IpAddress = '$ip'
`$env:Agent__Cnc__Port = '$port'
`$env:Agent__Mqtt__Host = 'localhost'
`$env:Agent__Mqtt__Port = '1883'
`$env:Agent__Server__BaseUrl = '$ServerUrl'
Set-Location '$PublishDir'
& '$dotnet' StarWebCNC.Agent.dll "--Agent:AgentId=$agentId" "--Agent:MachineId=$machineId" "--Agent:TemplateId=$templateId" "--Agent:Cnc:IpAddress=$ip" "--Agent:Cnc:Port=$port" "--Agent:Mqtt:Host=localhost" "--Agent:Mqtt:Port=1883" "--Agent:Server:BaseUrl=$ServerUrl" *>> '$logFile'
"@ | Out-File -FilePath $psScript -Encoding utf8

    Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$psScript`"" `
        -WindowStyle Hidden

    Write-Host "  [$machineId] IP=$ip Port=$port Template=$templateId log=$logFile"
}

Write-Host "[agents] All agents launched."