# Bindery MCP Server — Walkthrough

This document explains the vNext MCP server layout and core flows.

## Architecture

```
src/
  main.rs
  config.rs
  format.rs
  merge.rs
  tools/
    health.rs
    sync_workspace.rs
    index_build.rs
    index_status.rs
    retrieve_context.rs
    get_text.rs
    get_review_text.rs
    get_chapter.rs
    get_overview.rs
    get_notes.rs
    search.rs
    format.rs
    merge.rs
    tasks.rs
  docstore/
    discover.rs
    chunk.rs
    read.rs
  index/
    lexical.rs
    vector.rs
    meta.rs
  embeddings/
    provider.rs
    ollama.rs
    onnx.rs
    none.rs
  retrieve/
    hybrid.rs
    normalize.rs
```

```mermaid
graph TD
    main[main.rs] —> config[config.rs]
    main —> tools[tools/*]
    main —> format[format.rs]
    main —> merge[merge.rs]
    main —> embeddings[embeddings/*]
    tools —> docstore[docstore/*]
    tools —> index[index/*]
    tools —> retrieve[retrieve/*]
    embeddings —> ollama[ollama.rs]
    embeddings —> onnx[onnx.rs]
    embeddings —> none[none.rs]
```

## Embeddings Module

The `embeddings/` module provides a trait-based abstraction for embedding providers:

- **`provider.rs`**: Defines the `EmbeddingProvider` trait with `embed()`, `is_available()`, `model()`, and `backend()` methods.
- **`ollama.rs`**: Connects to a local Ollama server for embeddings.
- **`onnx.rs`**: Connects to a Windows ONNX embedding server (GPU via DirectML). Includes auto-start capability.
- **`none.rs`**: Fallback when no embeddings are configured.

### ONNX Auto-Start

The `OnnxProvider` can automatically spawn the Windows ONNX server from WSL if it’s not running:

1. On first embedding request, checks `/health` endpoint
2. If unreachable, converts `BINDERY_SOURCE_ROOT` from WSL path (`/mnt/d/…`) to Windows path (`D:\…`)
3. Spawns `scripts\start_onnx_server.cmd` via `cmd.exe` (WSL interop)
4. Polls until healthy (60s timeout)
5. Proceeds with embedding request

This adds ~10-30s cold start latency but requires no Task Scheduler or service setup.

## Startup

- `dotenvy::dotenv().ok()` is called at the top of `main()`.
- `Config::from_env()` resolves `SOURCE_ROOT`, `WORK_ROOT`, and `INDEX_DIR`.
- A single-line startup summary is written to stderr.

## Build Location (WSL)

- The source of truth lives on `/mnt/c`.
- **Always** copy `mcp-rust/` to WSL ext4 (e.g., `~/src/bindery-mcp`) and build there.
- Building on `/mnt/c` is slow and triggers performance warnings.

Optional automation:
- Set `BINDERY_MCP_MIRROR_ROOT`.
- Call `sync_workspace` with `paths` including `”mcp-rust”` to mirror the server source.

## Tools

### `health`
Returns diagnostics:
- current working directory
- resolved roots
- last sync timestamp (if manifest exists)
- embeddings backend + reachability
- index presence

### `sync_workspace`
Deprecated. Uses `rsync` (or a fallback copy) to mirror `/mnt/c` content into `WORK_ROOT`, then writes:
`.bindery/work_manifest.json` under the mirror. Use `index_build` instead, which
syncs automatically before indexing.

### `index_build`
- Syncs the index corpus from `/mnt/c` → `WORK_ROOT` (default: `Story`, `Notes`)
- Discovers all chapter files (EN + NL) plus story-level docs and notes under `WORK_ROOT`
- Chunks markdown by paragraph
- Builds Tantivy BM25 index (lexical)
- Builds HNSW vector store when embeddings are reachable (Ollama/ONNX calls use a blocking HTTP client safe for Tokio)
- Writes `meta.json` with schema version and build details

### `index_status`
Reads `meta.json` and reports index presence.

### `retrieve_context`
Hybrid retrieval:
1) BM25 top candidates
2) HNSW candidates (if available)
3) Merge + normalize scores
4) Filter by language (if specified):
   - `EN` → only paths containing `/EN/` plus language-neutral files (Notes/, Story/Details_*)
   - `NL` → only paths containing `/NL/` plus language-neutral files
   - `ALL` (default) → all indexed content
5) Rerank and return capped snippets

### `get_text`
Reads by identifier from `SOURCE_ROOT` (mount). Accepts relative paths or shorthand like `chapter8`, `act2 chapter9`, `details_overall`, `agents`.

### `get_review_text`
Returns a structured `git diff` with per-file hunks and filled context lines. Supports `EN`/`NL`/`ALL` filters and ignores CR-at-EOL to prevent line-ending noise on Windows.

### `get_chapter`
Returns a full chapter by number and language from `SOURCE_ROOT`.

### `get_overview`
Returns an act/chapter overview parsed from Story arc files on `SOURCE_ROOT`.

### `get_notes`
Returns a named entry from `Notes/Details_Notes.md` on `SOURCE_ROOT`.

### `search`
Literal/regex search under `SOURCE_ROOT/Story`, `SOURCE_ROOT/Notes`, plus root `AGENTS.md` and `Details_*.md`.

### `format`
Applies typography formatting (curly quotes, ellipsis, em-dash) to markdown files under `SOURCE_ROOT` (or explicit `path`).

### `merge`
Merges chapters into a single markdown and optionally exports DOCX/EPUB under `SOURCE_ROOT` (or explicit `root`). Requires Pandoc for DOCX/EPUB. DOCX export uses `reference.docx` when present. DOCX/EPUB outputs omit a TOC and embed chapter images from `images/` (e.g., `chapter1.jpg`). DOCX inserts `Story/<lang>/cover.jpg` as a cover page when present and EPUB splits per chapter. Prologue/Epilogue headings are taken from file content (no duplicate generated headings).

**EPUB/DOCX Metadata:** The following metadata is embedded:
- `title` – Book title from `Details_Translation_notes.md`
- `author` – From `BINDERY_AUTHOR` env var (optional)
- `lang` – ISO 639-1 code (`en` or `nl`) based on language
- `date` – Current date in `YYYY-MM-DD` format

### `task_status`
Returns status of background tasks. Pass `task_id` to query a specific task, or omit to list all.

## Background Tasks

The `TaskManager` in `tools/tasks.rs` provides a simple in-memory task tracking system:

- `create_task(type)` → creates a task with status `running`, returns UUID
- `update_progress(id, current, total, message)` → updates progress
- `complete_task(id, result)` → marks completed with JSON result
- `fail_task(id, error)` → marks failed with error message
- `cleanup_old_tasks(max_age_hours)` → removes old completed tasks

Tools like `index_build` support `background: true` to spawn work in a thread and return immediately with a task_id. The caller can poll `task_status` to check completion.

