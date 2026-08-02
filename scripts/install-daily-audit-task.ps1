# Installs (or updates) the Windows Scheduled Task that runs
# scripts/_audit-catalog.mjs every morning.
#
# Usage:
#   pwsh -File scripts\install-daily-audit-task.ps1                 # create / update
#   pwsh -File scripts\install-daily-audit-task.ps1 -Uninstall      # remove the task
#   pwsh -File scripts\install-daily-audit-task.ps1 -TimeOfDay 08:30
#
# Behavior:
# - Triggers at 07:00 every day (override via -TimeOfDay).
# - StartWhenAvailable = true: if the PC was off, the task runs as soon as
#   it is powered back on (automatic catch-up).
# - Wake to run stays false: we do not wake the PC for this.
# - Executes in the repo directory (working directory = this folder).
# - Logs stdout+stderr to scripts/daily-audit-cron.log (rolling; the human
#   report stays in scripts/daily-audit-log.md written by the Node script).
#
# Prereqs: PowerShell 5.1+ (built-in on Windows 10/11), Node.js on PATH,
# Chrome installed at the standard location (see CHROME_PATH in the Node script).
#
# Encoding: this file is saved as UTF-8 with BOM so PowerShell 5.1 parses
# it correctly on French/German Windows locales. Content is ASCII-only
# for maximum robustness.

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

# Resolve the node binary. Prefer `node` on PATH; fall back to the standard
# Windows install path.
$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($NodeCmd) {
    $NodeExe = $NodeCmd.Source
} else {
    $NodeExe = "C:\Program Files\nodejs\node.exe"
    if (-not (Test-Path $NodeExe)) {
        throw "Node.js not found. Install it or add it to PATH."
    }
}
Write-Host "Node exe : $NodeExe"
Write-Host "Repo root : $RepoRoot"

# Command line executed by the task:
#   cmd /c "cd repo && node scripts\_audit-catalog.mjs >> log 2>&1"
# We wrap in cmd /c because we need shell redirection for the log.
$LogPath = Join-Path $RepoRoot "scripts\daily-audit-cron.log"
$ScriptPath = Join-Path $RepoRoot "scripts\_audit-catalog.mjs"
$CmdArgs = "/c `"cd /d `"$RepoRoot`" && `"$NodeExe`" `"$ScriptPath`" >> `"$LogPath`" 2>&1`""

$Action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $CmdArgs

# Daily trigger at the requested time.
$Trigger = New-ScheduledTaskTrigger -Daily -At $TimeOfDay

# Settings:
# - StartWhenAvailable: catches up if the PC was off at trigger time.
# - AllowStartIfOnBatteries + DontStopIfGoingOnBatteries: runs on battery too.
# - ExecutionTimeLimit 1h: kills any zombie run past one hour.
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# Principal: run as the current user, interactive logon, standard privileges.
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
Write-Host "Force a test run:"
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
Write-Host ""
Write-Host "stdout+stderr log : $LogPath"
Write-Host "Structured report : scripts\daily-audit-log.md"
