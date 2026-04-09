# Bindery

Markdown book authoring toolkit: a **VS Code extension** for typography formatting and multi-format export, paired with an **MCP server** for full-text search and AI assistant integration.

## Origin

This project started as a personal writing tool, born out of frustration with the copy-paste loop that most AI-assisted writing ends up as.

It started with Word and ChatGPT — writing a chapter, copying it into the browser, getting feedback, pasting it back. That got old fast. Moving to VS Code and markdown files seemed like the natural next step: plain text, version control, and the ability to plug in an MCP server so an agent like Codex could read the book directly. In practice though, I still fell back to copy-pasting for feedback and only really used the tooling for typography formatting. That frustration is what pushed the VS Code extension into existence — at minimum, the formatting should just work without any ceremony.

The bigger shift came with Claude Cowork, which combines the session memory of a long-running agent with direct file access. That made the MCP server genuinely useful: the agent could navigate chapters, search for context, and keep track of the story across a session without being handed everything manually. The extension and MCP server now support both workflows — VS Code agents (Copilot, Codex, Claude for VS Code) and standalone Claude Desktop / Cowork.

## Components

### [vscode-ext/](vscode-ext/) — VS Code Extension

The **Bindery** extension provides:

- **Typography formatting** — curly quotes, em-dashes, ellipses, smart apostrophes
- **Chapter merge & export** — Markdown, DOCX, EPUB, PDF output via Pandoc + LibreOffice
- **Dialect conversion** — US→UK spelling with extensible substitution rules (`.bindery/translations.json`)
- **Multi-language support** — configurable per-language chapter labelling and folder structure
- **Workspace config** — `.bindery/settings.json` for project-level settings
- **MCP integration** — registers Bindery tools for GitHub Copilot Chat and writes `.vscode/mcp.json` for Claude / Codex

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=option-a.bindery) or:

```bash
cd vscode-ext
npm install
npm run compile
npx @vscode/vsce package
```

See [vscode-ext/README.md](vscode-ext/README.md) for full documentation.

### [mcp-ts/](mcp-ts/) — MCP Server (Node.js / TypeScript)

A [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes your book project to AI assistants. Pure Node.js — no Rust, no WSL, no extra installs.

- **BM25 full-text search** — fast lexical search across all chapters and notes via [MiniSearch](https://lucaong.github.io/minisearch/)
- **Optional semantic search** — set `BINDERY_OLLAMA_URL` for semantic reranking, or enable a full semantic index for precomputed embedding search
- **Tools** — `list_books`, `identify_book`, `search`, `get_chapter`, `get_overview`, `get_notes`, `get_text`, `get_review_text`, `git_snapshot`, `format`, `index_build`, `index_status`, `health`
- **Version tracking** — `get_review_text` shows uncommitted changes as a structured diff; `git_snapshot` saves progress as a git commit scoped to story/notes/arc folders. Git is auto-initialised during workspace setup if available
- **Multi-book support** — configure one or more books via `--book Name=path` CLI args or `BINDERY_BOOKS` env var; every tool call specifies which book to use by name (agents never see raw paths)
- **Container/mount aware** — agents in sandboxed environments (e.g. Cowork) can call `identify_book` with their working directory to discover their book name, even when mount paths differ from the configured paths

### [mcpb/](mcpb/) — Claude Desktop Extension

Packages the MCP server as a `.mcpb` file for one-click installation in Claude Desktop or Cowork.

**Download the latest release** from [Releases](../../releases) — no build step needed.

## Quick Start

### VS Code (Copilot / Claude / Codex)

1. Install the [Bindery extension](https://marketplace.visualstudio.com/items?itemName=option-a.bindery) from the Marketplace
2. Open your book folder in VS Code
3. Run `Bindery: Initialise Workspace` to create `.bindery/settings.json` (also initialises a git repo if not present)
4. Run `Bindery: Register MCP Server` to create `.vscode/mcp.json`
5. Tools are now available in GitHub Copilot Chat, Claude for VS Code, and Codex

### Claude Desktop / Cowork

1. Download `bindery-mcp-*.mcpb` from the [latest release](../../releases/latest)
2. Open Claude Desktop → Settings → Extensions → Install from file
3. Fill in the **Books** field with semicolon-separated `Name=path` pairs:
   `ScaryBook=C:\Users\My\Projects\ScaryBook;MyNovel=D:\Writing\MyNovel`
4. Optionally set the **Ollama URL** if you want semantic reranking
5. Optionally enable the semantic index and choose a default search mode if you want `full_semantic` search with rebuild warnings when the embedding index becomes stale
5. Tools are now available — the agent calls `list_books` to discover book names

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
- **Git** (recommended) — needed for version tracking, `get_review_text`, and `git_snapshot`. Auto-initialised during workspace setup. [Install](https://git-scm.com)
- **Pandoc** (optional) — needed for DOCX/EPUB/PDF export. [Install](https://pandoc.org/installing.html)
- **LibreOffice** (optional) — needed for PDF export only. [Install](https://www.libreoffice.org)
- **Ollama** (optional) - needed for semantic reranking and search. [Install](https://ollama.com/)

## Privacy

Bindery stays within your workspace, only if the optional Ollama URL is filled for the MCP server will texts be sent to Ollama for embedding / semantic search. The full privacy policy can be viewed at [https://www.option-a.tech/projects/bindery/privacy](https://www.option-a.tech/projects/bindery/privacy)

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

1. Builds and tests the MCP server.
2. Copies `mcp-ts/src/templates.ts` → `vscode-ext/src/ai-setup-templates.ts`.
3. Verifies the copy is identical to the source (fails with a clear remediation message if not).
4. Builds and tests the VS Code extension.

If CI fails on the sync check, fix it by running the copy command above and committing the result.
