# Bindery {{VERSION}}

## Highlights

- `bindery_health` now checks the latest GitHub release and reports installed/latest version, plus whether auto-download is available (`can_auto_download_release`) when `BINDERY_MCP_LOCATION` is configured
- Added optional `BINDERY_MCP_LOCATION` + `bindery_download_latest_mcp` for standalone ZIP-based MCP clients; the tool only downloads/unpacks and never edits client settings (Claude Desktop/Cowork remains `.mcpb` install flow)
- See attached assets below for install-ready downloads.

## Release Assets

- bindery-{{VERSION}}.mcpb (Claude Desktop / Cowork MCP package)
- bindery-mcp-server-{{VERSION}}.zip (Standalone MCP package for clients that support command + args + env configuration, such as ChatGPT Work and LM Studio)
- bindery-{{VERSION}}.vsix (VS Code extension)
- bindery-obsidian-bundled-{{VERSION}}.zip (Obsidian plugin bundle)
- obsidian-plugin/dist/main.js and obsidian-plugin/dist/manifest.json (raw Obsidian artifacts for obsidian automated scanning)

## Installation

- VS Code extension and MCP setup overview: https://github.com/evdboom/Bindery/blob/main/README.md
- MCP package details and manual install: https://github.com/evdboom/Bindery/blob/main/mcpb/README.md
- Standalone MCP zip quick install: included README.md inside bindery-mcp-server-{{VERSION}}.zip

## Notes

- Release notes below this section are auto-generated from merged pull requests and commits.