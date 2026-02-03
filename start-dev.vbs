Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c ""cd /d " & Replace(WScript.ScriptFullName, "\start-dev.vbs", "") & "\packages\web && npx vite""", 0, False
