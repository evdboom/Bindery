# Bindery

Markdown book authoring toolkit: a **VS Code extension** for typography formatting and multi-format export, paired with an **MCP server** for full-text search and AI assistant integration.

## Origin

This project started as a personal writing tool, born out of frustration with the copy-paste loop that most AI-assisted writing ends up as.

It started with Word and ChatGPT: writing a chapter, copying it into the browser, getting feedback, pasting it back. Versioning was an issue and keeping the ChatGPT project up to date with recent .docx files was a lot of work. Moving to VS Code and Markdown files seemed like the natural next step: plain text, version control, and the ability to plug in an MCP server so an agent like Codex could read the book directly.

In practice though, I still fell back to copy-pasting for feedback and only really used the tooling for typography formatting. Most VS Code extensions are built for coding: short iterations where the code is the truth, rather than the longer-running, chat-based sessions you get in web tools. That frustration is what pushed the VS Code extension into existence. At minimum, the formatting and exporting should just work without any ceremony.

The bigger shift came with Claude Cowork, which combines the session memory of a long-running agent with direct file access. That made the MCP server genuinely useful: the agent could navigate chapters, search for context, and keep track of the story across a session without being handed everything manually. The extension and MCP server now support both workflows: VS Code agents (Copilot, Codex, Claude for VS Code) and standalone Claude Desktop / Cowork.

## Components

### [vscode-ext/](vscode-ext/) — VS Code Extension

The **Bindery** extension provides:

- **Typography formatting** — curly quotes, em-dashes, ellipses, smart apostrophes (on save or on demand)
- **Chapter merge & export** — Markdown, DOCX, EPUB, PDF output via Pandoc + LibreOffice, with auto-detection of tool paths
- **Dialect & translation management** — extensible substitution rules for dialect exports (e.g. US→UK), plus cross-language glossaries in `.bindery/translations.json`
- **Multi-language support** — configurable per-language chapter labelling and folder structure, with dialect derivatives
- **Workspace config** — `.bindery/settings.json` for project-level settings
- **MCP integration** — registers 25 Bindery tools for GitHub Copilot Chat and writes `.vscode/mcp.json` for Claude / Codex

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=option-a.bindery) or:

```bash
cd vscode-ext
npm install
npm run compile
npx @vscode/vsce package
```

See [vscode-ext/README.md](vscode-ext/README.md) for full documentation.

### [mcp-ts/](mcp-ts/) — MCP Server (Node.js / TypeScript)

A [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes your book project to AI assistants. Pure Node.js.

- **BM25 full-text search** — fast lexical search across all chapters and notes via [MiniSearch](https://lucaong.github.io/minisearch/)
- **Optional semantic search** — set `BINDERY_OLLAMA_URL` for semantic reranking, or enable a full semantic index for precomputed embedding search
- **Version tracking** — `get_review_text` returns a structured git diff **plus** any regions wrapped in `<!-- Bindery: Review start --> ... <!-- Bindery: Review stop -->` markers (so committed work-in-progress can still be reviewed). `git_snapshot` saves progress as a git commit scoped to story/notes/arc folders. Git is auto-initialized during workspace setup if available
- **Translation & dialect management** — glossary entries and dialect substitution rules in `.bindery/translations.json`, queryable and updatable by agents
- **Session memory** — persistent `.bindery/memories/` files for cross-session decisions, with append, list, and compact operations
- **Chapter status tracking** — per-chapter progress tracker (`draft`, `in-progress`, `done`, `needs-review`)
- **Multi-book support** — configure one or more books via `--book Name=path` CLI args or `BINDERY_BOOKS` env var; every tool call specifies which book to use by name (agents never see raw paths)
- **Container/mount aware** — agents in sandboxed environments (e.g. Cowork) can call `identify_book` with their working directory to discover their book name, even when mount paths differ from the configured paths

See [mcpb/README.md](mcpb/README.md) for the full 27-tool reference and usage examples.


### [mcpb/](mcpb/) — Claude Desktop Extension

Packages the MCP server as a `.mcpb` file for one-click installation in Claude Desktop or Cowork.

**Download the latest release** from [Releases](../../releases) — no build step needed.

## Quick Start

### VS Code (Copilot / Claude / Codex)

1. Install the [Bindery extension](https://marketplace.visualstudio.com/items?itemName=option-a.bindery) from the Marketplace
2. Open your book folder in VS Code
3. Run `Bindery: Initialize Workspace` to create `.bindery/settings.json` (also initializes a git repo if not present)
4. Run `Bindery: Register MCP Server` to create `.vscode/mcp.json` (primarily for Claude/Codex discovery; not needed for GitHub Copilot Chat because the extension registers the tools automatically)
5. Tools are now available in GitHub Copilot Chat, Claude for VS Code, and Codex

### Claude Desktop / Cowork

1. Download `bindery-mcp-*.mcpb` from the [latest release](../../releases/latest)
2. Open Claude Desktop → Settings → Extensions → Install from file
3. Fill in the **Books** field with semicolon-separated `Name=path` pairs:
   `ScaryBook=C:\Users\My\Projects\ScaryBook;MyNovel=D:\Writing\MyNovel`
4. Optionally set the **Ollama URL** if you want semantic reranking
5. Optionally enable the semantic index and choose a default search mode if you want `full_semantic` search with rebuild warnings when the embedding index becomes stale.
   - **Note:** full embedding can be a heavy operation, depending on your hardware, when running a local Ollama instance.
6. Tools are now available — the agent calls `list_books` to discover book names

### Formatting & Export only (no MCP)

The VS Code extension works standalone — no server setup needed for typography formatting and export.

## Project Structure

```
├── vscode-ext/          VS Code extension (TypeScript)
│   ├── src/             Extension source
│   ├── package.json     Extension manifest
│   └── README.md        Extension docs
├── mcp-ts/              MCP server (Node.js / TypeScript)
│   ├── src/             Server source
│   └── package.json     Package manifest
├── mcpb/                Claude Desktop extension package (.mcpb)
│   ├── manifest.json    Extension metadata and tool list
│   └── server/          Populated by CI (mcp-ts build output)
└── LICENSE              MIT
```

## Prerequisites

- **VS Code** 1.85+
- **Git** (recommended) — needed for version tracking, `get_review_text`, and `git_snapshot`. Auto-initialized during workspace setup.
  - Install via package manager or from [https://git-scm.com](https://git-scm.com)
- **Pandoc** (optional) — needed for DOCX/EPUB/PDF export.
  - Install via package manager or from [https://pandoc.org/installing.html](https://pandoc.org/installing.html)
- **LibreOffice** (optional) — needed for PDF export only.
  - Install via package manager or from [https://www.libreoffice.org](https://www.libreoffice.org)
- **Ollama** (optional) — needed for semantic reranking and search.
  - Install via package manager or from [https://ollama.com/](https://ollama.com/)

### Pandoc / LibreOffice auto-detection

On all platforms the extension resolves tool paths in this order:

1. Explicit `bindery.pandocPath` / `bindery.libreOfficePath` user setting (if set and the file exists)
2. Command on `PATH` (`where.exe` on Windows, `which` elsewhere)
3. Well-known install locations:
   - **Windows**: `%LOCALAPPDATA%\Pandoc\pandoc.exe`, `%ProgramFiles%\Pandoc\pandoc.exe`, `%ProgramFiles%\LibreOffice\program\soffice.exe`
   - **macOS**: `/opt/homebrew/bin/pandoc`, `/usr/local/bin/pandoc`, `/Applications/LibreOffice.app/Contents/MacOS/soffice`
   - **Linux**: `/usr/bin/pandoc`, `/usr/bin/libreoffice`

You usually do not need to configure anything — install Pandoc/LibreOffice normally and exports will work. Use the `bindery_health` MCP tool to see what was detected.

## Known limitations

- **Git** must be on `PATH` (or at a standard install location) for `get_review_text` and `git_snapshot`. If git isn't found, these tools fail with a clear error; all other tools still work.
- **Pandoc** is required for DOCX, EPUB, and PDF export. Markdown-only export has no external dependencies.
- **LibreOffice** is required only for PDF export. Bindery generates PDFs by producing a DOCX via Pandoc and then converting with LibreOffice headless.
- **Semantic search** requires an optional [Ollama](https://ollama.com/) instance. Without it, lexical BM25 search still works offline. Configure with `BINDERY_OLLAMA_URL`; optional tuning via `BINDERY_OLLAMA_TIMEOUT_MS` (default 15000) and `BINDERY_OLLAMA_RETRIES` (default 1).
- **Large books with semantic indexing** can take several minutes to embed on first build. Rebuilds are incremental when chapter content is unchanged.
- **Chapter numbering**: the tools sort chapters by filename but accept non-contiguous numbers. `get_overview` now flags gaps (e.g. chapters 1, 3 with no 2) as a warning.
- **Search index format**: bumped automatically when the on-disk format changes. Older indexes are silently ignored and rebuilt on next use — no manual action required.

## Privacy

Bindery stays within your workspace, only if the optional Ollama URL is filled for the MCP server will texts be sent to Ollama for embedding / semantic search. The full privacy policy can be viewed at [https://evdboom.nl/projects/bindery/privacy](https://evdboom.nl/projects/bindery/privacy)

## License

MIT — see [LICENSE](LICENSE).

## Contributing — template source of truth

The AI instruction file templates are maintained in **one place only**:

```
mcp-ts/src/templates.ts   ← SINGLE SOURCE OF TRUTH
```

`vscode-ext/src/ai-setup-templates.ts` is a generated copy and **must never be edited directly**.
CI syncs it automatically before every publish step.

### Syncing locally

After changing `mcp-ts/src/templates.ts`, copy it to the VS Code extension:

```bash
cp mcp-ts/src/templates.ts vscode-ext/src/ai-setup-templates.ts
```

### Running tests

```bash
# MCP server (includes template contract tests + copy-parity check)
cd mcp-ts && npm test

# VS Code extension
cd vscode-ext && npm test
```

The copy-parity test (`mcp-ts/test/templates-parity.test.ts`) skips gracefully when
`ai-setup-templates.ts` is absent (normal in fresh checkouts) and **fails** when it exists
but differs from the source — this is what CI catches.

### What CI does

The CI workflow (`.github/workflows/ci.yml`) runs on every push and pull request:

1. Builds and tests the MCP server (Ubuntu, Windows, macOS).
2. Copies `mcp-ts/src/templates.ts` → `vscode-ext/src/ai-setup-templates.ts`.
3. Verifies the copy is identical to the source (fails with a clear remediation message if not).
4. Builds and tests the VS Code extension.
5. Runs the **tool parity guard** (`scripts/check-tool-parity.mjs`) — verifies all MCP tools are registered consistently across all 5 surfaces (server, VS Code LM tools, package.json, mcpb manifest, implementation).
6. Enforces **coverage thresholds** (statements 80%, branches 65%, functions 90%, lines 80%) for both packages.

If CI fails on the sync check, fix it by running the copy command above and committing the result.
