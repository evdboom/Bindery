# Bindery Standalone MCP Server Package

This package contains:

- `server/index.js` (the bundled Bindery MCP server)
- `README.md` (this file)

## Install in any MCP client

1. Unzip this archive to a stable folder on your machine.
2. In your MCP client, add a new MCP server.
   - eg. in ChatGPT Work -> **Settings** -> **Plug-ins** -> **MCPs** tab
3. Use the following values:
   - Command: `node`
   - Args: absolute path to `server/index.js` in the folder you unzipped
4. Configure environment variables (at minimum `BINDERY_BOOKS`).

## Environment variables

- `BINDERY_BOOKS` (required)
  - Semicolon-separated `Name=path` pairs.
  - Example: `MyBook=C:\Users\Me\MyBook;MyNovel=D:\Writing\MyNovel`
- `BINDERY_OLLAMA_URL` (optional)
  - Ollama endpoint for semantic reranking/full semantic search.
  - Example: `http://localhost:11434`
- `BINDERY_ENABLE_SEMANTIC_INDEX` (optional)
  - `true` to enable full semantic index builds via `index_build`.
  - Default: `false`
- `BINDERY_DEFAULT_SEARCH_MODE` (optional)
  - One of `lexical`, `semantic_rerank`, `full_semantic`.
  - Default: `lexical`

## Notes

- Keep the unzipped folder in place after configuring the MCP server.
- If Node is not on PATH, use the absolute path to the Node executable as Command.
- If Node is not installed at all you can get it from https://nodejs.org/
- This package is suitable for any MCP client that supports executable command + arguments + environment variables (for example ChatGPT Work or LM Studio).
