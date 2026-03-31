# ONNX Embedding Server — Standalone Installation

This guide sets up the ONNX embedding server in its own directory with its own Python environment, independent of the Bindery repository. The MCP server (running in WSL) will call this server over HTTP for GPU-accelerated embeddings.

## 1. Choose an install location (Windows)

Pick a directory on your Windows machine. Examples:

```
C:\Tools\onnx-embeddings
D:\Services\onnx-embeddings
%USERPROFILE%\onnx-embeddings
```

For this guide we’ll use `<ONNX_DIR>` as a placeholder. Replace it with your chosen path.

```powershell
mkdir <ONNX_DIR>
cd <ONNX_DIR>
```

## 2. Copy the server files

From the Bindery repo, copy these files into `<ONNX_DIR>`:

```powershell
copy <Bindery_repo>\_src\scripts\onnx_embed_server.py .
copy <Bindery_repo>\_src\scripts\onnx_requirements.txt .
copy <Bindery_repo>\_src\scripts\onnx_export_requirements.txt .
copy <Bindery_repo>\_src\scripts\start_onnx_server_standalone.cmd .\start_onnx_server.cmd
copy <Bindery_repo>\_src\scripts\start_onnx_silent.ps1 .
```

Note: the standalone cmd file is renamed to `start_onnx_server.cmd` — this is the name the MCP server expects.

## 3. Create a Python virtual environment

Requires Python 3.10+ (python.org install recommended over Microsoft Store for services).

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

## 4. Export the ONNX model (one-time)

This step converts the PyTorch model to ONNX format. It needs `onnxruntime` (CPU) + `torch`, which conflict with the DirectML runtime, so we do this first and then swap.

```powershell
# Install export dependencies
pip install -r onnx_export_requirements.txt

# Export the model (creates onnx\bge-m3\ directory)
optimum-cli export onnx —model BAAI/bge-m3 —task feature-extraction onnx\bge-m3
```

This downloads ~2 GB and takes a few minutes.

## 5. Switch to runtime dependencies

```powershell
# Remove conflicting packages
pip uninstall onnxruntime onnxruntime-directml -y

# Install DirectML runtime
pip install -r onnx_requirements.txt
```

## 6. Verify it works

```powershell
# Set env vars for this session
$env:ONNX_MODEL_ID = “onnx\bge-m3”
$env:ONNX_EXPORT = “0”

# Start the server
python onnx_embed_server.py
```

You should see:
```
ONNX provider: DmlExecutionProvider (available: […])
INFO:     Uvicorn running on http://0.0.0.0:11435
```

Test from another terminal:
```powershell
curl http://localhost:11435/health
```

Should return: `{“ok”:true,”model”:”onnx\\bge-m3”,”provider”:”DmlExecutionProvider”}`

Press Ctrl+C to stop.

## 7. Persist environment variables

So you don’t need to set them every session:

```powershell
setx ONNX_MODEL_ID “onnx\bge-m3”
setx ONNX_EXPORT “0”
```

## 8. (Optional) Autostart with Task Scheduler

There are two variants depending on your machine setup:

### Option A — Personal machine (run whether logged on or not)

On a personal machine with a local account, Task Scheduler can run the server as a
background process even before you log in. No visible window, no wrapper script needed.

1. Open Task Scheduler (`taskschd.msc`)
2. **Create Task** (not Basic Task)
3. **General:** Name it `ONNX Embedding Server`, select **Run whether user is logged on or not**
4. **Trigger:** At startup
5. **Action:** Start a program
   - Program: `<ONNX_DIR>\start_onnx_server.cmd`
   - Start in: `<ONNX_DIR>`
6. **Conditions:** Uncheck “Start only if on AC power” (if on laptop)
7. **Settings:** Check “If the task fails, restart every 1 minute” (up to 3 times)

> **Note:** DirectML (GPU) requires a user session to initialize. If embeddings fail or fall back
> to CPU when no one is logged in, switch to Option B.

### Option B — Domain-joined machine, or when Option A has GPU issues (run at log on)

On domain-joined machines, “run whether logged on or not” often fails (requires domain
credentials and DirectML needs an interactive session). Instead, run at log on with a silent
launcher to keep the terminal hidden.

1. Open Task Scheduler (`taskschd.msc`)
2. **Create Task** (not Basic Task)
3. **General:** Name it `ONNX Embedding Server`, leave **Run only when user is logged on** selected
4. **Trigger:** At log on (for your user account)
5. **Action:** Start a program
   - Program: `powershell.exe`
   - Arguments: `-WindowStyle Hidden -ExecutionPolicy Bypass -NonInteractive -File “<ONNX_DIR>\start_onnx_silent.ps1”`
   - Start in: `<ONNX_DIR>`
6. **Conditions:** Uncheck “Start only if on AC power”
7. **Settings:** Check “If the task fails, restart every 1 minute” (up to 3 times)

> **Note:** The `.ps1` wrapper launches `start_onnx_server.cmd` without a visible terminal.
> A `.vbs` wrapper (`start_onnx_silent.vbs`) exists for reference but VBScript is deprecated
> in Windows 11 24H2+ and will be disabled by default around 2027 — use the PS1 instead.

## 9. (Optional) Autostart as a Windows Service (NSSM)

```powershell
nssm install OnnxEmbeddings “<ONNX_DIR>\start_onnx_server.cmd”
nssm set OnnxEmbeddings AppDirectory “<ONNX_DIR>”
nssm set OnnxEmbeddings DisplayName “ONNX Embedding Server”
nssm set OnnxEmbeddings Description “GPU-accelerated embedding server (DirectML)”
nssm set OnnxEmbeddings Start SERVICE_AUTO_START
nssm start OnnxEmbeddings
```

## Final directory layout

```
<ONNX_DIR>\
  start_onnx_server.cmd          # Launcher script
  start_onnx_silent.ps1          # Silent launcher (no terminal window, for Task Scheduler)
  onnx_embed_server.py           # FastAPI server
  onnx_requirements.txt          # Runtime deps
  onnx_export_requirements.txt   # Export deps (keep for reference)
  onnx\
    bge-m3\                      # Exported ONNX model files
  .venv\                         # Python virtual environment
```

## Telling the MCP server where to find it

In your MCP server’s `.env` file, add:

```dotenv
BINDERY_ONNX_SERVER_DIR=<ONNX_DIR as Windows path>
```

For example:
```dotenv
BINDERY_ONNX_SERVER_DIR=C:\Tools\onnx-embeddings
```

If this variable is not set, the MCP server falls back to looking for `start_onnx_server.cmd` under `{BINDERY_SOURCE_ROOT}\_src\scripts\`.
