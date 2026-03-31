# Bindery MCP Server — Setup & Verification Guide

This guide covers building, configuring, and verifying the MCP server in WSL, including connecting it to the ONNX embedding server on Windows and to Cowork.

## Prerequisites

- WSL2 with Ubuntu (22.04+)
- Rust toolchain installed in WSL
- The ONNX embedding server running on Windows (see `SETUP_ONNX_SERVER.md`), OR Ollama in WSL
- Pandoc installed in WSL (for DOCX/EPUB/PDF export via `merge` tool)
- LibreOffice installed in WSL (for PDF export via `merge` tool — see below)

## 1. Check if already installed

If you’ve previously set up the MCP server, check if the binary and workspace exist:

```bash
# Check for the binary
ls -la ~/bindery_source/target/release/bindery-mcp 2>/dev/null

# Check for workspace directories
ls -d ~/bindery_work ~/bindery_cache ~/bindery_source 2>/dev/null

# Check if .env exists
cat ~/bindery_source/.env 2>/dev/null
```

If all three exist, skip to **Step 4 (Verify)**.

## 2. First-time WSL setup

```bash
sudo apt update
sudo apt install -y build-essential pkg-config libssl-dev git jq ripgrep rsync pandoc libreoffice

# Install Rust (if not already present)
which cargo || (curl https://sh.rustup.rs -sSf | sh && source ~/.cargo/env)
```

Create the workspace directories:

```bash
mkdir -p ~/bindery_work
mkdir -p ~/bindery_cache/.bindery/index
mkdir -p ~/bindery_cache/.bindery/logs
mkdir -p ~/bindery_source
```

## 3. Build / Update the MCP server

Copy the source to ext4 (never build on `/mnt/c` — it’s 10-50x slower):

```bash
rsync -a —checksum —prune-empty-dirs \
  —exclude ‘target/’ \
  /mnt/c/<path-to-your-repo>/_src/mcp-rust/ \
  ~/bindery_source/
```

Build in release mode:

```bash
cd ~/bindery_source
cargo build —release
```

The binary is at `~/bindery_source/target/release/bindery-mcp`.

## 4. Configure the .env file

Create or edit `~/bindery_source/.env` (you can copy the `~/bindery_source/.env.example`):

```dotenv
# === Required ===
# Where the Bindery repo lives (Windows mount path as seen from WSL)
BINDERY_SOURCE_ROOT=/mnt/c/<path-to-your-repo>

# ext4 workspace for indexing (fast IO)
BINDERY_WORK_ROOT=/home/<user>/bindery_work

# Index storage
BINDERY_INDEX_DIR=/home/<user>/bindery_cache/.bindery/index

# === Embedding backend (pick one) ===
BINDERY_EMBEDDINGS_BACKEND=onnx

# — ONNX settings —
# BINDERY_ONNX_URL is optional: if omitted, the server auto-detects the Windows
# host IP at startup via `ip route` (the WSL default gateway). Set it explicitly
# only if auto-detection fails or you use a non-standard setup.
# BINDERY_ONNX_URL=http://<windows-host-ip>:11435
#
# BINDERY_ONNX_PORT is optional: port the ONNX server listens on (default: 11435).
# Combine with auto-detect: set only this if you changed the port but not the IP.
# BINDERY_ONNX_PORT=11435
BINDERY_ONNX_MODEL=bge-m3

# Standalone ONNX server directory (Windows path)
# If set, auto-start looks here instead of under SOURCE_ROOT
BINDERY_ONNX_SERVER_DIR=C:\Tools\onnx-embeddings

# — OR Ollama settings —
# BINDERY_EMBEDDINGS_BACKEND=ollama
# BINDERY_OLLAMA_URL=http://127.0.0.1:11434
# BINDERY_OLLAMA_MODEL=nomic-embed-text

# === PDF export ===
# LibreOffice is used to convert DOCX → PDF. The default works on WSL/Linux after:
#   sudo apt install libreoffice
# On a Windows-native setup, set the full path to soffice.exe instead:
# BINDERY_LIBREOFFICE_PATH=C:\Program Files\LibreOffice\program\soffice.exe
BINDERY_LIBREOFFICE_PATH=libreoffice

# === Optional ===
BINDERY_MAX_RESPONSE_BYTES=60000
BINDERY_SNIPPET_MAX_CHARS=1600
BINDERY_DEFAULT_TOPK=6
BINDERY_AUTHOR=Erik
```

### Finding the Windows host IP

The ONNX server listens on `0.0.0.0:11435` on Windows. The MCP server auto-detects
the Windows host IP at startup by reading the WSL default gateway (`ip route`), so
you don’t need to set `BINDERY_ONNX_URL` manually.

If auto-detection fails (e.g. unusual network config), you can override it explicitly:

```bash
ip route | awk ‘/default/ {print $3; exit}’
```

Then set `BINDERY_ONNX_URL=http://<that-ip>:11435` in your `.env`. If you only changed
the port, you can set just `BINDERY_ONNX_PORT=<port>` and let the IP auto-detect.

## 5. Verify the server works

### Quick smoke test (stdio mode)

```bash
cd ~/bindery_source
echo ‘{“jsonrpc”:”2.0”,”id”:1,”method”:”initialize”,”params”:{“protocolVersion”:”2025-11-25”,”capabilities”:{},”clientInfo”:{“name”:”test”,”version”:”0.1”}}}’ | ./target/release/bindery-mcp 2>/dev/null | head -1
```

You should get a JSON response with `”serverInfo”`.

### Test the health tool

```bash
cd ~/bindery_source
(echo ‘{“jsonrpc”:”2.0”,”id”:1,”method”:”initialize”,”params”:{“protocolVersion”:”2025-11-25”,”capabilities”:{},”clientInfo”:{“name”:”test”,”version”:”0.1”}}}’; echo ‘{“jsonrpc”:”2.0”,”id”:2,”method”:”tools/call”,”params”:{“name”:”health”,”arguments”:{}}}’) | ./target/release/bindery-mcp 2>/dev/null
```

Look for `embeddings_backend: “onnx”` and `embeddings_available: true` in the response.

### Verify ONNX connectivity from WSL

```bash
ONNX_IP=$(ip route | awk ‘/default/ {print $3; exit}’)
curl -s “http://${ONNX_IP}:11435/health”
```

Should return `{“ok”:true,…}`.

## 6. Connect to Claude Desktop / Cowork

The MCP server can be packaged as a **Desktop Extension** (`.mcpb`) for
one-click installation in Claude Desktop. The extension is a thin Node.js
wrapper that spawns the Rust binary inside WSL via `wsl.exe` and bridges
stdio — no tunnels, no extra services.

### Architecture

```
Claude Desktop  <—>  Node.js bridge (stdio)  <—>  wsl.exe  <—>  bindery-mcp (Rust, WSL)
```

### Prerequisites

- The Rust binary is built in WSL (steps 1-3 above)
- Node.js is installed on Windows (ships with Claude Desktop)
- `@anthropic-ai/mcpb` is installed globally: `npm install -g @anthropic-ai/mcpb`

### Packaging the extension

The extension source lives in `_src/mcpb/`. To build the `.mcpb` file:

```powershell
cd _src\mcpb
mcpb pack
```

This produces `bindery-mcp-1.0.0.mcpb`.

### Installing in Claude Desktop

1. Open Claude Desktop.
2. Go to **Settings > Extensions**.
3. Click **Install from file** (or drag-drop the `.mcpb` file).
4. Fill in the configuration when prompted:
   - **WSL Binary Path**: `/home/erik/bindery_source/target/release/bindery-mcp`
   - **Source Root (repo path)**: `C:\Users\YourUser\YourRepo`
   - **Work Directory**: `/home/erik/bindery_work`
   - **Index Directory**: `/home/erik/bindery_cache/.bindery/index`
   - Leave other fields at their defaults unless you changed the ONNX setup.
5. Done — Bindery tools are now available in Claude Desktop and Cowork.

### How it works

The Node.js entry point (`server/index.js`) does the following:

1. Receives env vars from the manifest’s `user_config` (set during install).
2. Spawns `wsl.exe — bash -c “export …; cd <source_dir> && exec <binary>”`.
3. Pipes stdin/stdout between Claude Desktop and the Rust binary.
4. The Rust binary calls `dotenvy::dotenv()` which loads `.env` from the source dir;
   manifest env vars are already exported and take precedence over `.env` for overlapping keys.

Env vars from the manifest supplement (and can override) what the `.env` file
provides, so the `.env` remains the single source of truth for most settings.

### Updating the extension

After code changes, rebuild the Rust binary (step 7 below), then re-pack
and reinstall the extension:

```powershell
cd _src\mcpb
mcpb pack
# Then reinstall the .mcpb in Claude Desktop
```

### Note on Cowork

Cowork runs in an isolated Linux VM that cannot access WSL paths or the local
network directly. The desktop extension approach works because Claude Desktop
(running on Windows) spawns the MCP server natively and proxies it to Cowork’s
VM. This avoids the need for HTTPS tunnels or cloudflared.

## 7. Rebuild after code changes

When you update the Rust source:

```bash
# Sync changes from Windows mount to ext4
rsync -a —checksum —prune-empty-dirs \
  —exclude ‘target/’ \
  /mnt/c/<path>/_src/mcp-rust/ \
  ~/bindery_source/

# Rebuild
cd ~/bindery_source
cargo build —release
```

The MCP server will pick up the new binary on next launch (Cowork restarts it per session).

## Troubleshooting

**”Missing required env: BINDERY_SOURCE_ROOT”**
- The `.env` file isn’t being loaded. Make sure it’s in the same directory you run the binary from, or pass env vars explicitly.

**”ONNX server not running and neither BINDERY_ONNX_SERVER_DIR nor BINDERY_SOURCE_ROOT configured”**
- Set `BINDERY_ONNX_SERVER_DIR` to the Windows path of your standalone ONNX install.

**ONNX server unreachable from WSL**
- Check the Windows host IP: `ip route | awk ‘/default/ {print $3; exit}’`
- Make sure the ONNX server is actually running on Windows
- Check Windows Firewall isn’t blocking port 11435

**Slow index_build**
- Make sure `BINDERY_WORK_ROOT` and `BINDERY_INDEX_DIR` point to ext4 paths (under `/home/`), NOT `/mnt/c/`

**Vector index skipped / backend “none”**
- The embedding server isn’t reachable. Run `health` tool to diagnose.

**PDF export fails: “Failed to run LibreOffice”**
- LibreOffice is not installed or not in PATH. Run `sudo apt install libreoffice` in WSL.
- Verify with: `libreoffice —version`
- If using a custom install path, set `BINDERY_LIBREOFFICE_PATH` in your `.env` to the full binary path.

**PDF export fails: “LibreOffice PDF conversion failed”**
- LibreOffice ran but reported an error. Check that the intermediate DOCX was valid.
- Try running the conversion manually: `libreoffice —headless —convert-to pdf yourfile.docx —outdir /tmp`
