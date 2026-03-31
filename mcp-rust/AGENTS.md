# Bindery MCP Server – AGENTS

## Scope
- This file governs **tooling behavior only**.
- Do not apply story-writing or translation rules here.

## Server characteristics
- Runs locally via **stdio** in WSL.
- Operates on a **mirror workspace** in ext4.
- Source of truth remains on `/mnt/c`.

## Tool surface (v1)
- `health`
- `sync_workspace` (deprecated; use `index_build`)
- `index_build`
- `index_status`
- `retrieve_context`
- `get_text`
- `get_review_text`
- `search`
- `get_chapter`
- `get_overview`
- `get_notes`
- `merge`
- `format`

## Tooling rules
- Plain-text reads and searches must use **SOURCE_ROOT** (mount) so agents see the latest text:
	- `get_text`, `get_review_text`, `search`, `get_chapter`, `get_overview`, `get_notes`
- Indexing and embeddings must use **WORK_ROOT** only:
	- `index_build`, `retrieve_context`
- `merge` and `format` operate on **SOURCE_ROOT** (or explicit `root`/`path`).
- `merge` uses prologue/epilogue headings from the files (no generated duplicates).
- Prefer `retrieve_context`, `get_text`, `get_review_text` for context.
- Do **not** dump full book content into prompts.
- `get_review_text` ignores CR-at-EOL to avoid line-ending noise on Windows.
- When building the MCP server in WSL, **always** copy source to ext4 (e.g., `~/bindery_source`) and build there.
- Never build from `/mnt/c` (performance warning + slow IO).
- Optional: set `BINDERY_MCP_MIRROR_ROOT` and use `sync_workspace` with `”mcp-rust”` in `paths` to mirror the server source.
- If `sync_workspace` reports warnings, check `rsync_failures` for exit codes and stderr.
- If running the server directly with `cargo run`, rebuild after changes so the latest runtime-safe Ollama client is used.
- Embeddings backend can be `ollama`, `onnx`, or `none`.

## Indexing rules (critical)
Indexing and embeddings are **explicit maintenance operations**.
They MUST NOT be triggered implicitly.

### When to call `index_build`
Call `index_build` ONLY when:
1) The user explicitly asks to rebuild or update embeddings.
2) The user changed many chapters and asks for deep semantic recall.
3) Embedding backend/model/dim changed.

### When NOT to call `index_build`
- Reviewing recent edits.
- Reviewing a single chapter.
- Normal `retrieve_context` usage.

If results seem stale, warn the user and ask before rebuilding.

## Sync behavior
- `index_build` always syncs the index corpus from `/mnt/c` → `WORK_ROOT` before indexing.
- Minimum sync includes: `Story/EN`, `Story/NL`, `Story/AGENTS.md`, `Story/Details_*.md`, `Notes`, `AGENTS.md`, and any root-level `Details_*.md`.
- `sync_workspace` remains only for manual troubleshooting and is deprecated.
