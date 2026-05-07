Set WshShell = CreateObject("WScript.Shell")
Dim root
root = Replace(WScript.ScriptFullName, "\start-agent.vbs", "")
WshShell.Run "cmd /c """ & root & "\_runner-agent.bat""", 0, False
