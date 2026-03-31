# Bindery

Markdown book authoring toolkit: a **VS Code extension** for typography formatting and multi-format export, paired with an **MCP server** for hybrid semantic search and retrieval.

## Components

### [vscode-ext/](vscode-ext/) — VS Code Extension

The **Bindery** extension provides:

- **Typography formatting** — curly quotes, em-dashes, ellipses, smart apostrophes
- **Chapter merge & export** — Markdown, DOCX, EPUB, PDF output via Pandoc + LibreOffice
- **Dialect conversion** — US→UK spelling with extensible substitution rules
- **Multi-language support** — configurable per-language chapter labelling and folder structure
- **Workspace config** — `.bindery/settings.json` and `.bindery/translations.json` for project-level settings

Install from the VS Code Marketplace or build from source:

```bash
cd vscode-ext
npm install
npm run compile
npx @vscode/vsce package
```

See [vscode-ext/README.md](vscode-ext/README.md) for full documentation.

### [mcp-rust/](mcp-rust/) — MCP Server (Rust)

A [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes your book project to AI assistants. Built in Rust for fast hybrid retrieval:

- **BM25 + HNSW vector search** — hybrid retrieval across all chapters and notes
- **Embedding backends** — Ollama (local) or ONNX (Windows GPU via DirectML)
- **Tools** — `retrieve_context`, `get_chapter`, `get_overview`, `get_notes`, `search`, `get_review_text`, `merge`, `format`, and more
- **WSL-optimised** — source on Windows mount, indices on ext4 for performance

```bash
# In WSL:
cd mcp-rust
cp .env.example .env   # edit with your paths
cargo build —release
```

See [mcp-rust/README.md](mcp-rust/README.md) for setup instructions.

### [scripts/](scripts/) — ONNX Embedding Server

Optional GPU-accelerated embedding server (Python + DirectML) that runs on Windows and serves embeddings to the MCP server over HTTP.

See [SETUP_ONNX_SERVER.md](SETUP_ONNX_SERVER.md) for standalone installation.

### [mcpb/](mcpb/) — Claude Desktop Extension

Packages the MCP server as a `.mcpb` desktop extension for one-click installation in Claude Desktop / Cowork.

See [SETUP_MCP_SERVER.md](SETUP_MCP_SERVER.md) for build and install instructions.

## Quick Start

1. **Install the VS Code extension** — provides formatting and export without any server setup
2. **Optionally set up the MCP server** — adds semantic search and AI assistant integration
3. **Optionally set up ONNX embeddings** — enables GPU-accelerated vector search

## Project Structure

```
├── vscode-ext/          VS Code extension (TypeScript)
│   ├── src/             Extension source
│   ├── package.json     Extension manifest
│   └── README.md        Extension docs
├── mcp-rust/            MCP server (Rust)
│   ├── src/             Server source
│   ├── Cargo.toml       Rust manifest
│   ├── .env.example     Configuration template
│   └── README.md        Server docs
├── scripts/             ONNX embedding server (Python)
├── mcpb/                Claude Desktop extension package
├── SETUP_MCP_SERVER.md  MCP server setup guide
├── SETUP_ONNX_SERVER.md ONNX server setup guide
└── LICENSE              MIT
```

## License

MIT — see [LICENSE](LICENSE).
