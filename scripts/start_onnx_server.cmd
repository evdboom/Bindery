@echo off
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%\.."
call "%SCRIPT_DIR%\..\.venv\Scripts\activate.bat"
set ONNX_MODEL_ID=onnx\bge-m3
set ONNX_EXPORT=0
set ONNX_PROVIDER=DmlExecutionProvider
python scripts\onnx_embed_server.py