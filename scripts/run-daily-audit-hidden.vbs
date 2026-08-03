' Invisible launcher for the ComparasuisseDailyAudit scheduled task.
' Spawns powershell.exe with WScript.Shell.Run(..., 0, True) which sets
' the window style to "Hidden" (0) and waits for completion (True),
' so Task Scheduler sees the correct exit code AND no window ever appears.
'
' Why this dance is needed: Task Scheduler on Windows 10/11 always
' shows a brief cmd/powershell window flash when it launches a console
' program directly, even with -WindowStyle Hidden. wscript.exe is a
' Windows subsystem app (not console), so no window is ever created.
'
' Called by scripts\install-daily-audit-task.ps1 (see there for the
' full task definition).

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Resolve the wrapper .ps1 relative to this script's location.
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
wrapper = fso.BuildPath(scriptDir, "run-daily-audit.ps1")

cmd = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & wrapper & """"

' 0 = SW_HIDE, True = wait for exit. Exit code is returned to Task Scheduler.
ec = WshShell.Run(cmd, 0, True)
WScript.Quit ec
