# Bindery MCP — Desktop Extension (.mcpb)

This directory contains the files needed to package the Bindery MCP server
as a Claude Desktop Extension (.mcpb).

## How it works

The extension runs the Node.js MCP server directly. Claude Desktop
communicates with it over stdio, like any other MCP server.

Book paths are configured during installation via the **Books** setting,
which is passed to the server as the `BINDERY_BOOKS` env var.

## Prerequisites

1. `@anthropic-ai/mcpb` is installed globally: `npm install -g @anthropic-ai/mcpb`
2. The `server/` directory is populated with `mcp-ts` build output (handled by CI)

## Packaging

```powershell
cd mcpb
mcpb pack
```

This produces `bindery-mcp-<version>.mcpb`.

## Installing

1. Open Claude Desktop
2. Go to **Settings > Extensions**
3. Click **Install from file** (or drag-drop the `.mcpb` file)
4. Fill in the **Books** field with semicolon-separated `Name=path` pairs:
   `MyBook=C:\Users\Me\MyBook;MyNovel=D:\Writing\MyNovel`
5. Optionally set the **Ollama URL** if you want semantic reranking
6. Done — Bindery tools are now available in Claude Desktop and Cowork

## Configuration

| Setting | Required | Description |
|---------|----------|-------------|
| Books | Yes | Semicolon-separated `Name=path` pairs pointing to book projects |
| Ollama URL | No | URL for local Ollama instance (enables semantic reranking) |

## Files

- `manifest.json` — Extension metadata, tool declarations, user config schema
- `server/` — Populated by CI with the compiled mcp-ts server
- `icon.svg` — Extension icon
