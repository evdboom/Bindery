# Bindery MCP Server

Minimal MCP server focused on fast hybrid retrieval (BM25 + HNSW) with Ollama or ONNX embeddings. The source repo stays on the Windows mount (`/mnt/c`). All heavy IO happens on the WSL filesystem (ext4).

## WSL Setup (Ubuntu)

```bash
sudo apt update
sudo apt install -y build-essential pkg-config libssl-dev git jq ripgrep rsync python3 python3-venv
```

Install Rust:

```bash
curl https://sh.rustup.rs -sSf | sh
source ~/.cargo/env
rustup default stable
```

Create ext4 workspace:

```bash
mkdir -p ~/bindery_work
mkdir -p ~/bindery_cache/.bindery/index
mkdir -p ~/bindery_cache/.bindery/models
mkdir -p ~/bindery_cache/.bindery/logs
mkdir -p ~/bindery_source
```

## Choose Embedding provider

### Ollama (Embeddings Only)

Install Ollama inside WSL (Linux):

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Start the service (choose one):

```bash
# foreground
ollama serve

# or, if systemd is enabled in your WSL distro
sudo systemctl enable —now ollama
```

```bash
ollama serve
ollama pull nomic-embed-text
ollama list
```

### ONNX (Windows GPU via DirectML)

Optional: run a simple ONNX embedding server on Windows (GPU via DirectML) and point WSL to it.

#### First-time setup (model export)

The ONNX model must be exported once from PyTorch. This requires `onnxruntime` (CPU), which conflicts with `onnxruntime-directml` at runtime.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Install export dependencies
pip install -r scripts\onnx_export_requirements.txt

# Export the model
optimum-cli export onnx —model BAAI/bge-m3 —task feature-extraction onnx\bge-m3

# Swap to runtime dependencies (removes onnxruntime, installs onnxruntime-directml)
pip uninstall onnxruntime onnxruntime-directml -y
pip install -r scripts\onnx_requirements.txt

# Set env vars (setx persists for future shells; $env: applies to current session)
setx ONNX_MODEL_ID “onnx/bge-m3”
setx ONNX_EXPORT “0”
$env:ONNX_MODEL_ID = “onnx/bge-m3”
$env:ONNX_EXPORT = “0”
```

#### Start the ONNX server

```powershell
.\.venv\Scripts\Activate.ps1
python scripts\onnx_embed_server.py
```

The server auto-detects the best provider (DirectML → CUDA → CPU). To force a specific provider:

```powershell
$env:ONNX_PROVIDER = “CPUExecutionProvider”
python scripts\onnx_embed_server.py
```

### Autostart the ONNX server

#### Option A: Task Scheduler (simplest)

Use the provided batch file `scripts\start_onnx_server.cmd`. Edit the path inside if your repo is not at `C:\repo\Bindery`.

1. Open Task Scheduler (`taskschd.msc`)
2. Create Task (not Basic Task)
3. **General:** Name it `Bindery ONNX Server`, check “Run whether user is logged on or not”
4. **Trigger:** At startup (or at log on)
5. **Action:** Start a program
   - Program: `C:\repo\Bindery\scripts\start_onnx_server.cmd`
   - Start in: `C:\repo\Bindery`
6. **Conditions:** Uncheck “Start only if on AC power” if on laptop
7. **Settings:** Check “If the task fails, restart every 1 minute” (up to 3 times)

#### Option B: Windows Service (with NSSM)

[NSSM](https://nssm.cc/) wraps any executable as a Windows service with automatic restart.

1. Download NSSM and add to PATH (or use full path)

2. Install the service:

```powershell
nssm install BinderyONNX “C:\repo\Bindery\scripts\start_onnx_server.cmd”
nssm set BinderyONNX AppDirectory “C:\repo\Bindery”
nssm set BinderyONNX DisplayName “Bindery ONNX Embedding Server”
nssm set BinderyONNX Description “GPU-accelerated embedding server for Bindery”
nssm set BinderyONNX Start SERVICE_AUTO_START
```

3. Start the service:

```powershell
nssm start BinderyONNX
```

4. Manage the service:

```powershell
nssm status BinderyONNX   # check status
nssm restart BinderyONNX  # restart
nssm stop BinderyONNX     # stop
nssm remove BinderyONNX   # uninstall (prompts for confirmation)
```

> **Note:** NSSM services run as `LocalSystem` by default, which cannot access Microsoft Store Python. Either install Python from python.org for all users, or switch the service to run as your user account via `nssm edit BinderyONNX` → Log on tab.

#### Option C: On-demand auto-start (no setup required)

The MCP server can automatically spawn the ONNX server on first embedding request. This adds ~10-30s latency on cold start but requires no Task Scheduler or service configuration.

The server derives the script path from `BINDERY_SOURCE_ROOT` in `.env`:

```dotenv
BINDERY_SOURCE_ROOT=/mnt/d/Source/Bindery
BINDERY_EMBEDDINGS_BACKEND=onnx
BINDERY_ONNX_URL=http://<windows-host-ip>:11435
```

When an embedding is requested and the ONNX server isn’t running, the MCP server will:
1. Convert the WSL path to Windows path (`/mnt/d/…` → `D:\…`)
2. Spawn `scripts\start_onnx_server.cmd` via `cmd.exe` (WSL interop)
3. Poll until healthy (up to 60s timeout)
4. Proceed with the embedding request

#### Point WSL to the Windows ONNX server

Get the Windows host IP from inside WSL:

```bash
ip route | awk ‘/default/ {print $3; exit}’
```

Then set in your `.env`:

```dotenv
BINDERY_EMBEDDINGS_BACKEND=onnx
BINDERY_ONNX_URL=http://<windows-host-ip>:11435
BINDERY_ONNX_MODEL=bge-m3
```

## Configuration (.env)

Create a `.env` file inside `mcp-rust/` (see `.env.example`):

```dotenv
BINDERY_SOURCE_ROOT=/mnt/c/…/YourRepo
BINDERY_WORK_ROOT=/home/<user>/bindery_work
BINDERY_INDEX_DIR=/home/<user>/bindery_cache/.bindery/index

BINDERY_EMBEDDINGS_BACKEND=ollama
BINDERY_OLLAMA_URL=http://127.0.0.1:11434
BINDERY_OLLAMA_MODEL=nomic-embed-text

BINDERY_ONNX_URL=http://127.0.0.1:11435
BINDERY_ONNX_MODEL=bge-m3

# optional: mirror the MCP source into WSL ext4 for fast builds
BINDERY_MCP_MIRROR_ROOT=/home/<user>/src/bindery-mcp

BINDERY_SYNC_DELETE=false
BINDERY_MAX_RESPONSE_BYTES=60000
BINDERY_SNIPPET_MAX_CHARS=1600
BINDERY_DEFAULT_TOPK=6

# Author name for EPUB/DOCX metadata (optional)
BINDERY_AUTHOR=Your Name
```

## Build & Run (WSL)

**Important:** build and run from the WSL ext4 mirror, not from `/mnt/c`. Building on the mount is slow and causes performance warnings.

```bash
# one-time: copy source to WSL mirror
rsync -a —checksum —prune-empty-dirs /mnt/c/repo/YourRepo/mcp-rust/ ~/bindery_source/

cd ~/bindery_source
cargo build —release
./target/release/bindery-mcp
```

## Usage Flow

1) `index_build` (syncs `/mnt/c` → ext4 mirror, then builds lexical + vector indices)
   - To sync MCP source too, include `”mcp-rust”` in `sync_paths` and set `BINDERY_MCP_MIRROR_ROOT`
2) `retrieve_context` (fast hybrid retrieval)

## Tools

- `sync_workspace` (deprecated; use `index_build`)
- `index_build` (syncs the index corpus, then builds lexical + vector indices; set `background: true` to run async)
- `task_status` (check status of background tasks by `task_id`)
- `retrieve_context` (hybrid search: BM25 + vector; filter by language EN/NL/ALL)
- `get_review_text` (structured git diff with context; EN/NL/ALL filters; ignores CR-at-EOL to avoid CRLF noise)
- `get_chapter`
- `get_overview`
- `get_notes`
- `merge` (publish/export)
- `format`

### Multi-language Indexing

`index_build` always indexes **all languages** (EN + NL) into a single combined index:

```json
{“background”: true}
```

When retrieving, use `language` to filter results:

- `language: “EN”` — returns only English content (plus language-neutral files like Notes/ and Story/Details_*)
- `language: “NL”` — returns only Dutch content (plus language-neutral files)
- `language: “ALL”` (default) — returns all content

### Mount-first read tools

These tools read directly from `SOURCE_ROOT` so agents always see the latest text:

- `get_text` (identifier-based lookup like `chapter8`, `act2 chapter9`, `details_overall`, or a relative path)
- `search` (lexical search under `Story`, `Notes`, root `AGENTS.md`, and root `Details_*.md`)
- `get_review_text` (git diff from the mount repo)

### Background Tasks

For long-running operations like full `index_build`, use `background: true`:

```json
{“language”: “EN”, “background”: true}
```

Returns immediately with a `task_id`. Poll with `task_status`:

```json
{“task_id”: “<uuid>”}
```

Response includes `status` (`running`, `completed`, `failed`), `progress`, and `result` when done.

Indexing tools (`index_build`, `retrieve_context`) operate on `WORK_ROOT` only. Plain-text read/search tools (`get_text`, `search`, `get_review_text`, `get_chapter`, `get_overview`, `get_notes`) operate on `SOURCE_ROOT` (mount). `merge` and `format` operate on `SOURCE_ROOT` (or an explicit `root`/`path` argument). DOCX output uses `reference.docx` when present. DOCX/EPUB outputs do not include a TOC and will embed chapter images from `images/` (e.g., `chapter1.jpg`). DOCX also inserts `Story/<lang>/cover.jpg` as a cover page if present, and EPUB splits per chapter. Prologue/Epilogue headings come from the chapter files (no duplicate generated headings).

## Troubleshooting

- **Vector skipped / backend none**: `.env` not loaded or Ollama unreachable.
- **Slow responses**: you are reading from `/mnt/c` or indexes are on `/mnt/c`. Run `health` to confirm.
- **Stale mirror warning**: run `index_build` to resync and rebuild indices.
- **Sync warnings**: check the `rsync_failures` array for exit codes and stderr (from `index_build` or `sync_workspace`).
- **Tokio runtime drop panic on `cargo run`**: rebuild the latest binary; Ollama calls use a non-async HTTP client to avoid this.
- **Manually require Copy**: `rsync -a —checksum —delete —exclude ‘target/’ /mnt/c/repo/YourRepo/mcp-rust/ ~/bindery_source/`
