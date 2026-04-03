Set WshShell = CreateObject("WScript.Shell")
Dim root
root = Replace(WScript.ScriptFullName, "\start-dev.vbs", "")
WshShell.Run "cmd /c """ & root & "\_runner-dev.bat""", 0, False
