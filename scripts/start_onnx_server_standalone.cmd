@echo off
REM Standalone ONNX embedding server launcher.
REM Place this file alongside onnx_embed_server.py in your chosen install directory.
REM The .venv and onnx/ model folder should also be in this same directory.
REM
REM Expected directory layout:
REM   <ONNX_SERVER_DIR>\
REM     start_onnx_server.cmd      (this file, renamed)
REM     onnx_embed_server.py
REM     onnx\bge-m3\               (exported ONNX model)
REM     .venv\                     (Python virtual environment)

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"
call "%SCRIPT_DIR%.venv\Scripts\activate.bat"
set ONNX_MODEL_ID=onnx\bge-m3
set ONNX_EXPORT=0
set ONNX_PROVIDER=DmlExecutionProvider
python onnx_embed_server.py
