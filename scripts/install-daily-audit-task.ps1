# Installe (ou met à jour) la tâche planifiée Windows qui exécute
# scripts/_audit-catalog.mjs chaque matin.
#
# Usage :
#   pwsh -File scripts\install-daily-audit-task.ps1                 # crée / met à jour
#   pwsh -File scripts\install-daily-audit-task.ps1 -Uninstall      # supprime la tâche
#   pwsh -File scripts\install-daily-audit-task.ps1 -TimeOfDay 08:30
#
# Comportement :
# - Déclenche à 07:00 chaque jour (modifiable via -TimeOfDay).
# - StartWhenAvailable = $true : si le PC était éteint, la tâche se lance dès
#   qu'il est rallumé (rattrapage automatique).
# - Wake to run = $false par défaut : on ne réveille pas le PC pour rien.
# - Executes dans le répertoire du repo (working directory = ce dossier).
# - Log stdout+stderr dans scripts/daily-audit-cron.log (rolling, la sortie
#   humaine reste dans scripts/daily-audit-log.md côté script).
#
# Pré-requis : PowerShell 5.1+ (natif Windows 10/11), Node.js dans le PATH,
# Chrome installé à l'emplacement standard (voir CHROME_PATH dans le script).

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
        Write-Host "✅ Tâche $TaskName supprimée."
    } else {
        Write-Host "(rien à faire — tâche $TaskName inexistante)"
    }
    exit 0
}

# Résolution du binaire node — utilise `node` du PATH si dispo, sinon "node.exe"
# absolu (fallback classique Windows).
$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($NodeCmd) {
    $NodeExe = $NodeCmd.Source
} else {
    $NodeExe = "C:\Program Files\nodejs\node.exe"
    if (-not (Test-Path $NodeExe)) {
        throw "Node.js introuvable. Installe-le ou ajoute-le au PATH."
    }
}
Write-Host "Node exe : $NodeExe"
Write-Host "Repo root : $RepoRoot"

# Commande exécutée : `cd repo && node scripts\_audit-catalog.mjs >> log 2>&1`
# On passe par cmd /c pour supporter la redirection.
$LogPath = Join-Path $RepoRoot "scripts\daily-audit-cron.log"
$ScriptPath = Join-Path $RepoRoot "scripts\_audit-catalog.mjs"
$CmdArgs = "/c `"cd /d `"$RepoRoot`" && `"$NodeExe`" `"$ScriptPath`" >> `"$LogPath`" 2>&1`""

$Action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $CmdArgs

# Déclencheur quotidien à l'heure demandée
$Trigger = New-ScheduledTaskTrigger -Daily -At $TimeOfDay

# Settings :
# - StartWhenAvailable : rattrapage si PC éteint
# - DontStopIfGoingOnBatteries + AllowStartIfOnBatteries : tourne même sur batterie
# - ExecutionTimeLimit 1h : si le run dépasse 1h, kill (évite un run zombie)
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# Principal : run as current user, sans mot de passe, niveau standard
$Principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

# Enregistrement (upsert)
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Set-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal | Out-Null
    Write-Host "✅ Tâche $TaskName mise à jour (quotidien $TimeOfDay)."
} else {
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal | Out-Null
    Write-Host "✅ Tâche $TaskName créée (quotidien $TimeOfDay)."
}

Write-Host ""
Write-Host "Vérifie l'inscription :"
Write-Host "  Get-ScheduledTask -TaskName $TaskName"
Write-Host ""
Write-Host "Force un run test :"
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
Write-Host ""
Write-Host "Log stdout+stderr : $LogPath"
Write-Host "Rapport structuré : scripts\daily-audit-log.md"
