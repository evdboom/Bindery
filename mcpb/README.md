# Bindery MCP — Desktop Extension (.mcpb)

This directory contains the files needed to package the Bindery MCP server
as a Claude Desktop Extension (.mcpb).

## How it works

The extension is a thin Node.js bridge (`server/index.js`) that spawns the
native Rust MCP binary inside WSL via `wsl.exe`. Claude Desktop communicates
with it over stdio, exactly like any other MCP server.

```
Claude Desktop  <—>  Node.js bridge (stdio)  <—>  wsl.exe  <—>  bindery-mcp (Rust)
```

## Prerequisites

1. The Rust MCP server is built in WSL (see `SETUP_MCP_SERVER.md`)
2. `@anthropic-ai/mcpb` is installed globally: `npm install -g @anthropic-ai/mcpb`

## Packaging

```powershell
cd _src\mcpb
mcpb pack
```

This produces `bindery-mcp-1.0.0.mcpb`.

## Installing

1. Open Claude Desktop
2. Go to **Settings > Extensions**
3. Click **Install from file** (or drag-drop the `.mcpb` file)
4. Fill in the configuration (paths to your repo, work directory, etc.)
5. Done — Bindery tools are now available in Claude Desktop and Cowork

## Files

- `manifest.json` — Extension metadata, tool declarations, user config schema
- `server/index.js` — Node.js stdio bridge that spawns the WSL Rust binary
- `icon.svg` — Extension icon
