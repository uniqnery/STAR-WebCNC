Set WshShell = CreateObject("WScript.Shell")
Dim root
root = Replace(WScript.ScriptFullName, "\start-server.vbs", "")
WshShell.Run "cmd /c """ & root & "\_runner-server.bat""", 0, False
