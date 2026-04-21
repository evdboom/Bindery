# Bindery

Markdown book authoring tools for VS Code: typography formatting, multi-language chapter export (DOCX, EPUB, PDF), dialect conversion, translation management, and AI assistant integration via a bundled MCP server.

## Features

### Typography Formatting

Converts plain-text typography to professional typographic characters:

| Input | Output | Description |
|-------|--------|-------------|
| `...` | `…` | Ellipsis |
| `--` | `—` | Em-dash (preserves `---` for markdown HR) |
| `"text"` | `“text”` | Curly double quotes |
| `'text'` | `‘text’` | Curly single quotes |
| `don't` | `don’t` | Smart apostrophes |

HTML comments are preserved and not modified.

**How to use:**

- **Right-click** a markdown file → **Format Typography**
- **Format Document** (`Shift+Alt+F`) — registered as a markdown formatter
- **Format on Save** — enable `bindery.formatOnSave` in settings
- **Explorer** — right-click a folder → **Format All Markdown in Folder**

### Chapter Merge & Export

Merges ordered chapter files into a single document with TOC generation:

- **Markdown** (`.md`) — with table of contents and separators
- **DOCX** (`.docx`) — via Pandoc, with page breaks and optional cover image
- **EPUB** (`.epub`) — via Pandoc, with chapter splitting and optional cover
- **PDF** (`.pdf`) — via Pandoc (intermediate DOCX) + LibreOffice headless conversion, giving consistent output quality across all platforms

Dialect exports (e.g. British English from a US English source) are handled automatically: the extension copies the source language folder to a temporary dialect folder, applies all configured substitution rules, merges, and removes the temp folder after export.

**How to use:**

- **Editor toolbar** — click the $(book) **Bindery Export** button (visible on markdown files)
- **Command Palette** (`Ctrl+Shift+P`) → search "Bindery"

### Dialect & Translation Management

Substitution rules (e.g. US→UK spelling) are applied in tiers (later tiers win):

1. **Built-in** — common US→UK conversions (color→colour, center→centre, etc.)
2. **General** — `bindery.generalSubstitutions` in VS Code user settings (follows you to every workspace)
3. **Project** — `.bindery/translations.json` in the workspace

Cross-language glossary entries (e.g. EN→NL world terms) are also stored in `.bindery/translations.json` for agent reference and consistency checking.

### AI Assistant Integration (MCP)

Bindery includes a bundled MCP server that makes your book's chapters, notes, search index, memory, and translation data available to AI assistants directly inside VS Code.

**GitHub Copilot Chat** — tools are registered automatically when the extension activates. Use `#bindery_search`, `#bindery_get_chapter`, etc. in chat.

**Claude for VS Code / Codex** — run `Bindery: Register MCP Server` once per workspace. This writes `.vscode/mcp.json` pointing to the bundled server. Both extensions pick this up automatically on next reload.

#### Available MCP tools (26)

| Tool | Description |
|------|-------------|
| `bindery_health` | Check workspace status: settings, search index, and embedding backend |
| `bindery_init_workspace` | Create or update `.bindery/settings.json` and `translations.json` |
| `bindery_setup_ai_files` | Generate AI instruction files (CLAUDE.md, copilot-instructions.md, etc.) |
| `bindery_settings_update` | Merge a partial patch into `.bindery/settings.json` |
| `bindery_index_build` | Build or rebuild the search index (lexical + optional semantic) |
| `bindery_index_status` | Show index metadata and stale-status hints |
| `bindery_search` | Full-text search: lexical BM25, semantic rerank, or full semantic mode |
| `bindery_get_text` | Read any file by relative path, with optional line range |
| `bindery_get_chapter` | Full chapter content by number and language |
| `bindery_get_book_until` | Chapters from a start through a target chapter, concatenated in order |
| `bindery_get_overview` | Chapter structure — acts, chapters, titles |
| `bindery_get_notes` | Notes files, filterable by category or character name |
| `bindery_format` | Apply typography formatting to a file or folder |
| `bindery_get_review_text` | Structured git diff of uncommitted changes |
| `bindery_update_workspace` | Fetch and pull the current branch, with branch/default-branch reporting |
| `bindery_git_snapshot` | Save a snapshot (git commit) of story/notes/arc changes, with optional push |
| `bindery_get_translation` | Look up cross-language glossary entries |
| `bindery_add_translation` | Add or update a glossary entry |
| `bindery_get_dialect` | Look up dialect substitution rules |
| `bindery_add_dialect` | Add or update a dialect substitution rule |
| `bindery_add_language` | Add a language and scaffold its story folder |
| `bindery_memory_list` | List session memory files with line counts |
| `bindery_memory_append` | Append a dated entry to a memory file |
| `bindery_memory_compact` | Overwrite a memory file with a summary (backs up original) |
| `bindery_chapter_status_get` | Read per-chapter progress (draft, in-progress, done, needs-review) |
| `bindery_chapter_status_update` | Upsert chapter progress entries |

`bindery_search` supports `lexical`, `semantic_rerank`, and `full_semantic` modes. Semantic modes require an Ollama instance and fall back to lexical results with a warning if unavailable.

For the standalone MCP server (Claude Desktop / Cowork), two additional tools are available: `list_books` and `identify_book` for multi-book discovery. See [mcpb/README.md](../mcpb/README.md) for full MCP documentation and usage examples.

### File Discovery

The extension automatically discovers and orders your chapter files:

```
Story/
  EN/                          ← language folder
    Prologue.md                ← first
    Act I/                     ← act folders (sorted by Roman numeral)
      Chapter1.md              ← chapters (sorted by number)
      Chapter2.md
    Act II/
      Chapter9.md
    Epilogue.md                ← last
```

Localized prologue/epilogue names are supported (e.g. `Proloog.md` for Dutch) via the language configuration.

## Commands

All commands are available from the Command Palette (`Ctrl+Shift+P`) under the **Bindery** category.

| Command | Description |
|---------|-------------|
| `Initialize Workspace` | Create `.bindery/settings.json` and `translations.json` |
| `Setup AI Assistant Files` | Generate CLAUDE.md, copilot-instructions.md, .cursor/rules, AGENTS.md |
| `Register MCP Server` | Write `.vscode/mcp.json` for Claude / Codex MCP discovery |
| `Format Typography` | Apply typography formatting to the active markdown file |
| `Format All Markdown in Folder` | Apply typography to all `.md` files in a folder |
| `Merge Chapters → Markdown` | Merge chapters into a single `.md` file |
| `Merge Chapters → DOCX` | Merge chapters and export via Pandoc |
| `Merge Chapters → EPUB` | Merge chapters and export via Pandoc |
| `Merge Chapters → PDF` | Merge chapters via Pandoc + LibreOffice |
| `Merge Chapters → All Formats` | Export all configured formats at once |
| `Find Probable US→UK Words` | Scan `Story/EN` for likely US spellings |
| `Add Dialect Rule` | Add a dialect substitution rule (e.g. color→colour) |
| `Add Translation (Glossary)` | Add a cross-language glossary entry |
| `Add Language` | Add a new language and scaffold its story folder |
| `Open translations.json` | Open the translations file in the editor |

## Configuration

Settings can be defined in `.bindery/settings.json` (preferred) or VS Code settings (fallback).

| Setting | Default | Description |
|---------|---------|-------------|
| `bindery.storyFolder` | `"Story"` | Folder containing language subfolders |
| `bindery.languages` | EN | Language configurations (see below) |
| `bindery.mergedOutputDir` | `"Merged"` | Output directory for merged files |
| `bindery.author` | `""` | Author name for EPUB/DOCX metadata |
| `bindery.bookTitle` | `""` | Book title (string or per-language map) |
| `bindery.pandocPath` | `"pandoc"` | Path to Pandoc executable (auto-detected if left as default) |
| `bindery.libreOfficePath` | `"libreoffice"` | Path to LibreOffice executable (auto-detected if left as default) |
| `bindery.formatOnSave` | `false` | Auto-format typography on save (only files inside the story folder) |
| `bindery.mergeFilePrefix` | `"Book"` | Prefix for output filenames |
| `bindery.generalSubstitutions` | `[]` | Dialect substitution rules applied across all projects |

### Language Configuration

Each language entry supports:

```json
{
  "code": "EN",
  "folderName": "EN",
  "chapterWord": "Chapter",
  "actPrefix": "Act",
  "prologueLabel": "Prologue",
  "epilogueLabel": "Epilogue",
  "isDefault": true,
  "bookTitle": "The Hollow Road",
  "dialects": [
    { "code": "en-gb", "label": "British English" }
  ]
}
```

- `isDefault` marks the primary language (used as fallback for title resolution)
- `bookTitle` provides a per-language title override for export metadata
- `dialects` lists dialect codes that derive from this language; during export the extension copies the source folder, applies substitution rules from `.bindery/translations.json`, and merges the converted content

### Adding a New Language

Add to `.bindery/settings.json` (or `bindery.languages` in VS Code settings):

```json
{
  "languages": [
    { "code": "EN", "folderName": "EN", "chapterWord": "Chapter", "actPrefix": "Act", "prologueLabel": "Prologue", "epilogueLabel": "Epilogue", "isDefault": true },
    { "code": "FR", "folderName": "FR", "chapterWord": "Chapitre", "actPrefix": "Acte", "prologueLabel": "Prologue", "epilogueLabel": "Épilogue" }
  ]
}
```

Or use the `Bindery: Add Language` command, which scaffolds the story folder with stub files mirroring the default language structure.

## Requirements

- **VS Code** 1.85+
- **Git** (recommended) — needed for version tracking and review features. Auto-initialized during workspace setup. [Install](https://git-scm.com)
- **Pandoc** (optional) — needed for DOCX/EPUB/PDF export. [Install](https://pandoc.org/installing.html)
- **LibreOffice** (optional) — needed for PDF export only. [Install](https://www.libreoffice.org/download/download-libreoffice/)

### Pandoc / LibreOffice Auto-Detection

On all platforms the extension resolves tool paths automatically:

1. Explicit `bindery.pandocPath` / `bindery.libreOfficePath` user setting (if set and the file exists)
2. Command on `PATH` (`where.exe` on Windows, `which` elsewhere)
3. Well-known install locations:
   - **Windows**: `%LOCALAPPDATA%\Pandoc\pandoc.exe`, `%ProgramFiles%\Pandoc\pandoc.exe`, `%ProgramFiles%\LibreOffice\program\soffice.exe`
   - **macOS**: `/opt/homebrew/bin/pandoc`, `/Applications/LibreOffice.app/Contents/MacOS/soffice`
   - **Linux**: `/usr/bin/pandoc`, `/usr/bin/libreoffice`

You usually do not need to configure anything — install Pandoc/LibreOffice normally and exports will work.

## Building from Source

```bash
cd vscode-ext
npm install
npm run compile
```

To install locally:

```bash
npm install -g @vscode/vsce
vsce package
code --install-extension bindery-*.vsix
```
