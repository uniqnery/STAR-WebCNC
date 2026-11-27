param(
    [ValidateSet('Status', 'Enable', 'Disable', 'Run')]
    [string]$Action = 'Status'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtime = Join-Path $root 'agent-runtime\startup'
$intentFile = Join-Path $runtime 'enabled'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$hash = [Security.Cryptography.SHA256]::Create()
$suffix = ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant())))).Replace('-', '').Substring(0, 10)
$taskName = "Star-WebCNC-Startup-$suffix"
$legacyTaskArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $PSCommandPath + '" -Action Run'
$launcher = Join-Path $PSScriptRoot 'windows-startup.vbs'
$taskExecute = Join-Path $env:SystemRoot 'System32\wscript.exe'
$taskArgs = '//B //Nologo "' + $launcher + '"'

try {
    if ($Action -eq 'Run') {
        if (!(Test-Path -LiteralPath $intentFile)) { exit 0 }
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = $node
        $startInfo.Arguments = '"' + (Join-Path $PSScriptRoot 'windows-startup.cjs') + '"'
        $startInfo.WorkingDirectory = $root
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $coordinator = [System.Diagnostics.Process]::Start($startInfo)
        try {
            $coordinator.WaitForExit()
            exit $coordinator.ExitCode
        } finally {
            $coordinator.Dispose()
        }
    }

    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        $owner = $task.Principal.UserId
        if ($owner -notmatch '^S-1-') {
            $owner = (New-Object Security.Principal.NTAccount($owner)).Translate([Security.Principal.SecurityIdentifier]).Value
        }
        $actions = @($task.Actions)
        $currentAction = $actions.Count -eq 1 -and $actions[0].Arguments -eq $taskArgs -and $actions[0].Execute -eq $taskExecute
        $legacyAction = $actions.Count -eq 1 -and $actions[0].Arguments -eq $legacyTaskArgs -and $actions[0].Execute -eq (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
        if ((!$currentAction -and !$legacyAction) -or $owner -ne $identity.User.Value) {
            throw 'STARTUP_TASK_CONFLICT'
        }
    }

    if ($Action -eq 'Enable') {
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        foreach ($dependency in @('dotnet.exe', 'docker.exe')) {
            if (!(Get-Command $dependency -ErrorAction SilentlyContinue)) { throw 'STARTUP_DEPENDENCIES_MISSING' }
        }
        if (!(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'windows-startup.cjs')) -or !(Test-Path -LiteralPath $launcher) -or !(Test-Path -LiteralPath $taskExecute)) { throw 'STARTUP_FILES_MISSING' }
        New-Item -ItemType Directory -Path $runtime -Force | Out-Null
        $taskAction = New-ScheduledTaskAction -Execute $taskExecute -Argument $taskArgs -WorkingDirectory $root
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
        $principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Description 'Start Star-WebCNC services after this Windows user signs in.' -Force | Out-Null
        [IO.File]::WriteAllText($intentFile, 'enabled')
        $task = Get-ScheduledTask -TaskName $taskName
    } elseif ($Action -eq 'Disable') {
        if ($task) { Disable-ScheduledTask -TaskName $taskName | Out-Null }
        if (Test-Path -LiteralPath $intentFile) { Remove-Item -LiteralPath $intentFile }
        $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    }

    $info = if ($task) { Get-ScheduledTaskInfo -TaskName $taskName } else { $null }
    $report = $null
    $reportFile = Join-Path $runtime 'status.json'
    if (Test-Path -LiteralPath $reportFile) {
        try { $report = Get-Content -LiteralPath $reportFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
    }
    @{
        supported = $true
        enabled = [bool]($task -and $task.Settings.Enabled -and (Test-Path -LiteralPath $intentFile))
        taskName = $taskName
        taskState = if ($task) { [string]$task.State } else { 'NotRegistered' }
        serverName = $env:COMPUTERNAME
        windowsUser = $identity.Name
        lastRunAt = if ($info -and $info.LastRunTime.Year -gt 2000) { $info.LastRunTime.ToUniversalTime().ToString('o') } else { $null }
        lastTaskResult = if ($info) { $info.LastTaskResult } else { $null }
        report = $report
    } | ConvertTo-Json -Depth 5 -Compress
} catch {
    $permission = $_.Exception -is [UnauthorizedAccessException] -or $_.Exception.HResult -eq -2147024891 -or $_.Exception.Message -match '0x80070005|Access is denied'
    $code = if ($permission) { 'STARTUP_ADMIN_REQUIRED' } elseif ($_.Exception.Message -in @('STARTUP_TASK_CONFLICT', 'STARTUP_DEPENDENCIES_MISSING')) { $_.Exception.Message } else { 'STARTUP_CONFIGURATION_FAILED' }
    @{ error = $code } | ConvertTo-Json -Compress
    exit 1
}
