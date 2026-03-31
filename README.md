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
- **Optional Ollama reranking** — set `BINDERY_OLLAMA_URL` to enable semantic reranking on top of BM25
- **Tools** — `list_books`, `identify_book`, `retrieve_context`, `search`, `get_chapter`, `get_overview`, `get_notes`, `get_text`, `format`, `index_build`, `index_status`, `health`
- **Multi-book support** — configure one or more books via `--book Name=path` CLI args or `BINDERY_BOOKS` env var; every tool call specifies which book to use by name (agents never see raw paths)
- **Container/mount aware** — agents in sandboxed environments (e.g. Cowork) can call `identify_book` with their working directory to discover their book name, even when mount paths differ from the configured paths

### [mcpb/](mcpb/) — Claude Desktop Extension

Packages the MCP server as a `.mcpb` file for one-click installation in Claude Desktop or Cowork.

**Download the latest release** from [Releases](../../releases) — no build step needed.

## Quick Start

### VS Code (Copilot / Claude / Codex)

1. Install the [Bindery extension](https://marketplace.visualstudio.com/items?itemName=option-a.bindery) from the Marketplace
2. Open your book folder in VS Code
3. Run `Bindery: Initialise Workspace` to create `.bindery/settings.json`
4. Run `Bindery: Register MCP Server` to create `.vscode/mcp.json`
5. Tools are now available in GitHub Copilot Chat, Claude for VS Code, and Codex

### Claude Desktop / Cowork

1. Download `bindery-mcp-*.mcpb` from the [latest release](../../releases/latest)
2. Open Claude Desktop → Settings → Extensions → Install from file
3. Fill in the **Books** field with semicolon-separated `Name=path` pairs:
   `ScaryBook=C:\Users\My\Projects\ScaryBook;MyNovel=D:\Writing\MyNovel`
4. Optionally set the **Ollama URL** if you want semantic reranking
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

## License

MIT — see [LICENSE](LICENSE).
