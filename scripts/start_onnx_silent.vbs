Set WshShell = CreateObject("WScript.Shell")
WshShell.Run Chr(34) & Replace(WScript.ScriptFullName, "start_onnx_silent.vbs", "start_onnx_server.cmd") & Chr(34), 0, False
