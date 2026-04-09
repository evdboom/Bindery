# Bindery MCP — Desktop Extension (.mcpb)

Book authoring tools for Claude Desktop: chapter navigation, full-text search,
translation management, session memory, typography formatting, and version snapshots.
Works with any Markdown book project structured with the Bindery VS Code extension.

## Features

- **Chapter navigation** — jump to any chapter by number and language
- **Full-text search** — lexical BM25, semantic rerank, or full semantic search across the book corpus
- **Translation management** — list, look up, add, and update translation and dialect substitution rules
- **Session memory** — append, list, and compact persistent cross-session notes in `.bindery/memories/`
- **Workspace setup** — create or update `.bindery/settings.json` and scaffold AI instruction files
- **Chapter status tracking** — record and query per-chapter progress (draft, in-progress, done, needs-review)
- **Typography formatting** — curly quotes, em-dashes, ellipses
- **Version snapshots** — git-based save points after writing sessions
- **Review diffs** — structured git diff of uncommitted changes

## Manual Installation

To install manually without using published Claude Connectors

1. Download the `.mcpb` file from the latest release
2. Open Claude Desktop → **Settings** → **Extensions**
3. Click **Install from file** (or drag-drop the `.mcpb` file)
4. Fill in the **Books** field (see Configuration below)

## Configuration

| Setting | Required | Description |
|---------|----------|-------------|
| Books | Yes | Semicolon-separated `Name=path` pairs pointing to book projects |
| Ollama URL | No | URL for Ollama instance (enables semantic reranking, see [https://docs.ollama.com/quickstart](https://docs.ollama.com/quickstart)) |
| Build full semantic index | No | `true` to let `index_build` precompute embeddings for `full_semantic` search |
| Default search mode | No | `lexical`, `semantic_rerank`, or `full_semantic` |

**Books** example: `MyBook=C:\Users\Me\MyBook;MyNovel=D:\Writing\MyNovel`

## Examples

### Navigate a book's structure

> "Show me the chapter list for my book"

Claude calls `list_books` to discover the book name, then `get_overview` to show
all acts and chapters with titles.

### Search for a character's mentions

> "Where does Landa first meet the Keeper?"

Claude calls `search` with the query and returns the most relevant passages with file paths and line numbers, letting you jump straight to the scene.

If `full_semantic` is enabled and the semantic index is stale, Claude should call `index_status`, then recommend `index_build` before relying on semantic results.

### Add a dialect substitution rule

> "Add a substitution: 'color' should become 'colour' in en-gb"

Claude calls `add_dialect` with `dialectCode: "en-gb"`, `from: "color"`,
`to: "colour"`. The rule is saved to `.bindery/translations.json` and applied
automatically during future exports.

### Review and snapshot your changes

> "Review my changes and save a snapshot if they look good"

Claude calls `get_review_text` to show the diff, reviews it, then calls
`git_snapshot` to commit the changes with a descriptive message.

### Look up a glossary term

> "How is 'flux' translated in the Dutch version?"

Claude calls `get_translation` with `language: "nl"` and `word: "flux"`. The
lookup is forgiving — it matches case-insensitively and checks plural and
inflected forms automatically. If no glossary entry exists yet, Claude can call
`add_translation` with `targetLangCode: "nl"` to create one.

### List all dialect substitution rules

> "Show me all the British English substitution rules"

Claude calls `get_dialect` with `dialectCode: "en-gb"` (omitting `word`) to
dump every `from → to` rule in the `en-gb` entry of `.bindery/translations.json`.
Useful before an export session to see what spelling substitutions are configured.

### Save session decisions to memory

> "Save today's character decisions to memory"

Claude calls `memory_list` to check which files already exist and their sizes,
then calls `memory_append` with `file: "global.md"`, a short title, and the
decisions to record. The tool stamps the current date automatically — no manual
date formatting needed.

### Compact a memory file that has grown too large

> "The global memory file is getting long — please compact it"

Claude reads the current content, summarizes it, then calls `memory_compact`
with the compacted text. The original is automatically backed up to
`.bindery/memories/archive/global_YYYY-MM-DD.md` before the file is overwritten.

### Spot-check a chapter translation

> "Compare chapter 10 in EN and NL and flag any translation issues"

Claude calls `get_chapter` twice — once for EN, once for NL — then calls
`get_translation` with the target language to load the known term table.
Discrepancies are presented in a side-by-side table. Any confirmed corrections
are saved back with `add_translation` (glossary) or `add_dialect` (dialect substitutions).

### Check continuity across chapters

> "Check chapter 8 for consistency errors — character descriptions and world rules"

Claude calls `get_chapter` to read the chapter, `get_notes` to load character
profiles and world rules, then uses `search` to verify specific details against earlier chapters. Results are presented in a table with issue type, location, and the reference that contradicts it.

## Tools reference

| Tool | What it does |
|---|---|
| `list_books` | List all configured book names |
| `identify_book` | Match a working directory to a book name |
| `health` | Server status: settings, index, embedding backend |
| `init_workspace` | Create or update `.bindery/settings.json` and `translations.json` with smart defaults |
| `setup_ai_files` | Generate AI instruction files (CLAUDE.md, copilot-instructions.md, .cursor/rules, AGENTS.md) and Claude skill templates |
| `index_build` | Build or rebuild the lexical index and, when enabled, the semantic embedding index |
| `index_status` | Show lexical and semantic index status, build times, and stale hints |
| `get_text` | Read any file by relative path, with optional line range |
| `get_chapter` | Full chapter content by number and language |
| `get_overview` | Chapter structure — acts, chapters, titles |
| `get_notes` | Notes/ files, filterable by category or name |
| `search` | Search in lexical, semantic-rerank, or full-semantic mode; semantic modes fall back to lexical with warnings |
| `format` | Apply typography formatting to a file or folder |
| `get_review_text` | Structured git diff with optional auto-staging |
| `git_snapshot` | Git commit of story, notes, and arc changes |
| `get_translation` | List glossary entries for a language, or look up a specific term (forgiving) |
| `add_translation` | Add or update a cross-language glossary entry (agent reference) |
| `get_dialect` | List dialect substitution rules, or look up a specific word |
| `add_dialect` | Add or update a dialect substitution rule (auto-applied at export) |
| `add_language` | Add a language to settings.json and scaffold the story folder with stubs |
| `memory_list` | List memory files with line counts |
| `memory_append` | Append a dated session entry to a memory file |
| `memory_compact` | Overwrite a memory file with a summary (backs up original) |
| `chapter_status_get` | Read the chapter progress tracker — returns entries grouped by status (done, in-progress, draft, planned, needs-review) |
| `chapter_status_update` | Upsert chapter progress entries — send only changed chapters; unmentioned entries are preserved |

## Privacy Policy

Bindery MCP runs entirely on your local machine. No data is sent to external
servers. All file operations are performed on your local filesystem. If you
configure an Ollama URL, embedding requests are sent to that configured instance only.

Full policy: https://github.com/evdboom/Bindery/wiki/Privacy-policy

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
