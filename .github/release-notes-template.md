# Bindery {{VERSION}}

## Highlights

- Added a unified image-handling pipeline for exports: chapter image links are normalized and rewritten for portable merged output.
- Added legacy image migration support for older workspaces, including migration proposals and automatic settings updates when applied.
- VS Code extension and Obsidian plugin now prompt for legacy image migration and report migration results after applying changes.

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