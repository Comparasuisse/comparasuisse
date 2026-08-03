# Wrapper called by the ComparasuisseDailyAudit scheduled task.
# Separated from install-daily-audit-task.ps1 to avoid quote-escaping hell
# when Task Scheduler stores the cmd line - simpler and more reliable.
#
# Usage (manual):
#   pwsh -File scripts\run-daily-audit.ps1              # full audit
#   pwsh -File scripts\run-daily-audit.ps1 -Limit 5     # small sample for testing
#
# Behavior:
# - Sets the working directory to the repo root (so relative paths in the
#   Node script resolve correctly).
# - Resolves node.exe from PATH or from the standard Windows install path.
# - Appends stdout+stderr to scripts\daily-audit-cron.log with a timestamped
#   header/footer, plus the process exit code.
# - Exits with the same code as node so Task Scheduler can report failure.
#
# Encoding: UTF-8 with BOM (see install-daily-audit-task.ps1 for the reason).

param(
    [int]$Limit = 0
)

$ErrorActionPreference = "Continue"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

# Force UTF-8 for the console codepage so Node's emojis / accents in stdout
# do not get mangled when captured by Out-File. Without this, Out-File sees
# the current OEM codepage (typically 850 or 1252 on FR/DE Windows) and
# replaces every non-ASCII byte with garbled sequences in daily-audit-cron.log.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$env:PYTHONIOENCODING = "utf-8"
$OutputEncoding = [System.Text.Encoding]::UTF8

$LogPath = Join-Path $RepoRoot "scripts\daily-audit-cron.log"
$ScriptPath = Join-Path $RepoRoot "scripts\_audit-catalog.mjs"

$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($NodeCmd) {
    $NodeExe = $NodeCmd.Source
} else {
    $NodeExe = "C:\Program Files\nodejs\node.exe"
    if (-not (Test-Path $NodeExe)) {
        "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') FATAL node.exe not found" |
            Out-File -FilePath $LogPath -Append -Encoding utf8
        exit 127
    }
}

$header = "===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') run start (limit=$Limit) ====="
$header | Out-File -FilePath $LogPath -Append -Encoding utf8

$nodeArgs = @($ScriptPath)
if ($Limit -gt 0) {
    $nodeArgs += @("--limit", $Limit.ToString())
}

# *>&1 merges every stream (stdout, stderr, verbose, warning) into the
# pipeline so Out-File captures them all in the log.
& $NodeExe $nodeArgs *>&1 | Out-File -FilePath $LogPath -Append -Encoding utf8
$exit = $LASTEXITCODE

$footer = "===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') run end (exit=$exit) ====="
$footer | Out-File -FilePath $LogPath -Append -Encoding utf8

exit $exit
