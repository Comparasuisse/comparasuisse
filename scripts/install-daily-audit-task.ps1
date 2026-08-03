# Installs (or updates) the Windows Scheduled Task that runs
# scripts\_audit-catalog.mjs every morning.
#
# Usage:
#   pwsh -File scripts\install-daily-audit-task.ps1                 # create / update
#   pwsh -File scripts\install-daily-audit-task.ps1 -Uninstall      # remove the task
#   pwsh -File scripts\install-daily-audit-task.ps1 -TimeOfDay 08:30
#
# Behavior:
# - Triggers at 07:00 every day (override via -TimeOfDay).
# - StartWhenAvailable = true: if the PC was off at trigger time, the task
#   runs as soon as it is powered back on (automatic catch-up).
# - Task invokes wscript.exe scripts\run-daily-audit-hidden.vbs, which
#   spawns powershell.exe with a hidden window and waits for exit. Result:
#   ZERO visible window at any point, exit code still propagates to Task
#   Scheduler. This is the only reliable no-flash trick that works with
#   LogonType=Interactive (S4U needs admin rights to register).
# - Wrapper logs stdout+stderr to scripts\daily-audit-cron.log; the human
#   report is written by the Node script to scripts\daily-audit-log.md.
#
# Prereqs: PowerShell 5.1+ (built-in on Windows 10/11), Node.js on PATH,
# Chrome installed at the standard location (see CHROME_PATH in Node script).
#
# Encoding: UTF-8 with BOM so PowerShell 5.1 parses it correctly on
# French/German Windows locales. Content is ASCII-only for robustness.

param(
    [string]$TimeOfDay = "07:00",
    [switch]$Uninstall,
    [string]$TaskName = "ComparasuisseDailyAudit"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "[OK] Task $TaskName removed."
    } else {
        Write-Host "(nothing to do - task $TaskName does not exist)"
    }
    exit 0
}

$WrapperScript = Join-Path $RepoRoot "scripts\run-daily-audit.ps1"
$VbsLauncher = Join-Path $RepoRoot "scripts\run-daily-audit-hidden.vbs"
foreach ($p in @($WrapperScript, $VbsLauncher)) {
    if (-not (Test-Path $p)) { throw "Missing file: $p" }
}

Write-Host "Repo root    : $RepoRoot"
Write-Host "PS wrapper   : $WrapperScript"
Write-Host "VBS launcher : $VbsLauncher"

# Action: wscript.exe scripts\run-daily-audit-hidden.vbs
# wscript is a Windows subsystem app (no console) - it spawns powershell
# with a hidden window and waits, guaranteeing no visible flash at any
# point in the pipeline.
$Action = New-ScheduledTaskAction `
    -Execute "wscript.exe" `
    -Argument "`"$VbsLauncher`"" `
    -WorkingDirectory $RepoRoot

# Daily trigger at the requested time.
$Trigger = New-ScheduledTaskTrigger -Daily -At $TimeOfDay

# Settings:
# - StartWhenAvailable: catches up if PC was off at trigger time.
# - AllowStartIfOnBatteries + DontStopIfGoingOnBatteries: runs on battery.
# - Hidden: hides the task from casual "Interactive tasks" filter (also
#   suppresses any tray icon).
# - ExecutionTimeLimit 1h: kill any zombie run past one hour.
# - MultipleInstances IgnoreNew: if a run overlaps a previous run,
#   don't start a second copy.
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -Hidden `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -MultipleInstances IgnoreNew

# Principal: Interactive (works without admin elevation). Invisibility is
# handled by the VBS launcher, not by the logon type. S4U would also work
# but requires elevated rights at registration time.
$Principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

# Register or update (upsert).
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Set-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal | Out-Null
    Write-Host "[OK] Task $TaskName updated (daily at $TimeOfDay)."
} else {
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal | Out-Null
    Write-Host "[OK] Task $TaskName created (daily at $TimeOfDay)."
}

Write-Host ""
Write-Host "Verify the registration:"
Write-Host "  Get-ScheduledTask -TaskName $TaskName"
Write-Host ""
Write-Host "Force a test run (invisible - poll state to see when it finishes):"
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
Write-Host "  Get-ScheduledTaskInfo -TaskName $TaskName"
Write-Host ""
Write-Host "stdout+stderr log : scripts\daily-audit-cron.log"
Write-Host "Structured report : scripts\daily-audit-log.md"
