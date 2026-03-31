# Bindery MCP — Desktop Extension (.mcpb)

Book authoring tools for Claude Desktop: chapter navigation, full-text search,
translation management, typography formatting, and version snapshots. Works with
any Markdown book project structured with the Bindery VS Code extension.

## Features

- **Chapter navigation** — jump to any chapter by number and language
- **Full-text search** — BM25 ranked search across all story and notes files
- **Context retrieval** — "where did X happen" queries with ranked passages
- **Translation management** — add and update dialect substitution rules
- **Typography formatting** — curly quotes, em-dashes, ellipses
- **Version snapshots** — git-based save points after writing sessions
- **Review diffs** — structured git diff of uncommitted changes

## Installation

1. Download the `.mcpb` file from the latest release
2. Open Claude Desktop → **Settings** → **Extensions**
3. Click **Install from file** (or drag-drop the `.mcpb` file)
4. Fill in the **Books** field (see Configuration below)

## Configuration

| Setting | Required | Description |
|---------|----------|-------------|
| Books | Yes | Semicolon-separated `Name=path` pairs pointing to book projects |
| Ollama URL | No | URL for local Ollama instance (enables semantic reranking) |

**Books** example: `MyBook=C:\Users\Me\MyBook;MyNovel=D:\Writing\MyNovel`

## Examples

### Navigate a book's structure

> "Show me the chapter list for my book"

Claude calls `list_books` to discover the book name, then `get_overview` to show
all acts and chapters with titles.

### Search for a character's mentions

> "Where does Landa first meet the Keeper?"

Claude calls `retrieve_context` with the query and returns the most relevant
passages with file paths and line numbers, letting you jump straight to the scene.

### Add a translation rule

> "Add a substitution: 'color' should become 'colour' in en-gb"

Claude calls `add_translation` with `langKey: "en-gb"`, `from: "color"`,
`to: "colour"`. The rule is saved to `.bindery/translations.json` and applied
during future exports.

### Review and snapshot your changes

> "Review my changes and save a snapshot if they look good"

Claude calls `get_review_text` to show the diff, reviews it, then calls
`git_snapshot` to commit the changes with a descriptive message.

## Privacy Policy

Bindery MCP runs entirely on your local machine. No data is sent to external
servers. All file operations are performed on your local filesystem. If you
configure an Ollama URL, embedding requests are sent to that local instance only.

Full policy: https://option-a.tech/bindery/privacy

## Support

- GitHub Issues: https://github.com/evdboom/bindery/issues
- Repository: https://github.com/evdboom/bindery

## Packaging

```powershell
cd mcpb
mcpb pack
```

This produces `bindery-mcp-<version>.mcpb`.

## Files

- `manifest.json` — Extension metadata, tool declarations, user config schema
- `server/` — Populated by CI with the compiled mcp-ts server
- `icon.svg` — Extension icon
