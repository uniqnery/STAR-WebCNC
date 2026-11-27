Option Explicit

' A GUI host launches PowerShell hidden from its first instruction, before
' Windows can hand a new console to the default Terminal application.
Dim files, shell, root, script, executable, command, result
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
If Not files.FileExists(root & "\agent-runtime\startup\enabled") Then WScript.Quit 0
script = root & "\tools\windows-startup.ps1"
If Not files.FileExists(script) Then WScript.Quit 1
executable = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
shell.CurrentDirectory = root
command = """" & executable & """ -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """ -Action Run"
result = shell.Run(command, 0, True)
WScript.Quit result
