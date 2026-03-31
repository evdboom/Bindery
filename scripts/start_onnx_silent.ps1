# Launches start_onnx_server.cmd without a visible terminal window.
# Use this with Task Scheduler (run only when user is logged on).
# Replaces start_onnx_silent.vbs, which is deprecated in Windows 11 24H2+.
Start-Process -FilePath "$PSScriptRoot\start_onnx_server.cmd" -WindowStyle Hidden
