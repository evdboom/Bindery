# Bindery MCP — Desktop Packages

Book authoring tools for Claude Desktop: chapter navigation, full-text search,
translation management, session memory, typography formatting, and version snapshots.
Works with any Markdown book project structured with the Bindery VS Code extension.

## Features

- **Chapter navigation** — jump to any chapter by number and language
- **Full-text search** — lexical BM25, semantic rerank, or full semantic search across the book corpus
- **Translation management** — list, look up, add, and update translation and dialect substitution rules
- **Opinionated authoring scaffold** — initialize Arc, Notes, Characters, SESSION, PREFERENCES, and memory files for agent-assisted writing
- **Session memory** — append, list, and compact persistent cross-session notes in `.bindery/memories/`
- **Session focus** — read and update the ephemeral working-state file `SESSION.md` (current focus, next actions, open questions, handoff); durable preferences stay user-owned in `PREFERENCES.md`
- **Inbox triage** — enumerate loose `Notes/Inbox.md` items and propose destinations (`bindery_inbox_process`), then clear routed items after confirmation (`bindery_inbox_resolve`)
- **Workspace setup** — create or update `.bindery/settings.json`, `.bindery/translations.json`, `.bindery/README.md`, the opinionated authoring scaffold, and AI instruction files
- **Typography formatting** — curly quotes, em-dashes, ellipses
- **Workspace sync** — fetch and pull the current branch before a session, with branch/default-branch reporting
- **Version snapshots** — git-based save points after writing sessions
- **Review diffs** — structured git diff of uncommitted changes

## Manual Installation (Claude Desktop)

To install manually without using published Claude Connectors

1. Download the `.mcpb` file from the latest release
2. Open Claude Desktop → **Settings** → **Extensions**
3. Click **Install from file** (or drag-drop the `.mcpb` file)
4. Fill in the **Books** field (see Configuration below)

## Manual Installation (Standalone MCP clients)

1. Download the `bindery-mcp-server-*.zip` file from the latest release
2. Unzip it to a stable folder
3. In your MCP client, add a new MCP server.
   - eg. in ChatGPT Work -> **Settings** -> **Plug-ins** -> **MCPs** tab
4. With:
   - Command: `node`
   - Args: absolute path to `server/index.js` from the unzipped folder
5. Add environment variables:
   - `BINDERY_BOOKS` (required): semicolon-separated `Name=path` pairs
   - `BINDERY_OLLAMA_URL` (optional): Ollama endpoint for semantic features
   - `BINDERY_ENABLE_SEMANTIC_INDEX` (optional): `true` to enable full semantic index builds
   - `BINDERY_DEFAULT_SEARCH_MODE` (optional): `lexical`, `semantic_rerank`, or `full_semantic`
   - `BINDERY_MCP_LOCATION` (optional): stable folder for `bindery_download_latest_mcp` to download/unpack the latest standalone ZIP

### Update guidance

- `bindery_health` includes installed vs latest Bindery release information.
- `bindery_health` also returns `can_auto_download_release` and `mcp_download_location` based on `BINDERY_MCP_LOCATION`.
- If outdated, agents should report installed version, latest version, and the release URL.
- `bindery_download_latest_mcp` is for standalone ZIP-based MCP clients only; it downloads and unpacks but never edits client settings.
- Do not use `bindery_download_latest_mcp` in Claude Desktop/Cowork. For Claude, always install/update via `.mcpb` in Settings -> Extensions.

## Configuration

| Setting | Required | Description |
|---------|----------|-------------|
| Books | Yes | Semicolon-separated `Name=path` pairs pointing to book projects |
| Ollama URL | No | URL for Ollama instance (enables semantic reranking, see [https://docs.ollama.com/quickstart](https://docs.ollama.com/quickstart)) |
| Build full semantic index | No | `true` to let `bindery_index_build` precompute embeddings for `full_semantic` search |
| Default search mode | No | `lexical`, `semantic_rerank`, or `full_semantic` |

**Books** example: `MyBook=C:\Users\Me\MyBook;MyNovel=D:\Writing\MyNovel`

## Examples

### Navigate a book's structure

> "Show me the chapter list for my book"

Claude calls `bindery_list_books` to discover the book name, then `bindery_get_overview` to show
all acts and chapters with titles.

### Initialize an agent-ready book workspace

> "Set this folder up as a Bindery book"

Claude calls `bindery_init_workspace`. The tool creates `.bindery/settings.json`,
`.bindery/translations.json`, the generated `.bindery/README.md` capability
reference, and the default authoring scaffold: `SESSION.md`, `PREFERENCES.md`, `Arc/index.md`,
`Arc/Overall.md`, `Arc/Acts/`, `Notes/Inbox.md`, `Notes/Characters/index.md`,
structured note folders, `.bindery/memories/global.md`, and
the remaining scaffold files. Existing files are preserved.

After that, Claude can call `bindery_setup_ai_files` to generate CLAUDE.md,
Copilot instructions, Cursor rules, AGENTS.md, and Claude skill templates.

### Answer what Bindery can do

> "What can Bindery do for this book?"

Claude reads `.bindery/README.md`. That generated file is the canonical local
capability reference for the book, including available commands, MCP tools,
skill workflows, and the current opinionated authoring layout.

### Search for a character's mentions

> "Where does Landa first meet the Keeper?"

Claude calls `bindery_search` with the query and returns the most relevant passages with file paths and line numbers, letting you jump straight to the scene.

If `full_semantic` is enabled and the semantic index is stale, Claude should call `bindery_index_status`, then recommend `bindery_index_build` before relying on semantic results.

### Add a dialect substitution rule

> "Add a substitution: 'color' should become 'colour' in en-gb"

Claude calls `bindery_add_dialect` with `dialectCode: "en-gb"`, `from: "color"`,
`to: "colour"`. The rule is saved to `.bindery/translations.json` and applied
automatically during future exports.

### Review and snapshot your changes

> "Review my changes and save a snapshot if they look good"

Claude calls `bindery_get_review_text` to show the diff, reviews it, then calls
`bindery_git_snapshot` to commit the changes with a descriptive message. If you have configured a preferred push target, the same call can also push the snapshot.

### Sync the workspace before reading in

> "Update this workspace before we start"

Claude calls `bindery_update_workspace` to fetch and pull the current branch. If the current branch differs from the remote default branch, the tool reports that so Claude can ask whether to switch before continuing.

### Look up a glossary term

> "How is 'flux' translated in the Dutch version?"

Claude calls `bindery_get_translation` with `language: "nl"` and `word: "flux"`. The
lookup is forgiving — it matches case-insensitively and checks plural and
inflected forms automatically. If no glossary entry exists yet, Claude can call
`bindery_add_translation` with `targetLangCode: "nl"` to create one.

### List all dialect substitution rules

> "Show me all the British English substitution rules"

Claude calls `bindery_get_dialect` with `dialectCode: "en-gb"` (omitting `word`) to dump every `from → to` rule in the `en-gb` entry of `.bindery/translations.json`.
Useful before an export session to see what spelling substitutions are configured.

### Save session decisions to memory

> "Save today's character decisions to memory"

Claude calls `bindery_memory_list` to check which files already exist and their sizes,
then calls `bindery_memory_append` with `file: "global.md"`, a short title, and the
decisions to record. The tool stamps the current date automatically — no manual
date formatting needed.

### Create or append a story note

> "Add this world detail to the notes"

Claude calls `bindery_note_list` or `bindery_note_get` to find the right target under the configured notes folder, then uses `bindery_note_create` for a new note or `bindery_note_append` for an existing one. Older note layouts remain readable through `bindery_get_notes`.

### Compact a memory file that has grown too large

> "The global memory file is getting long — please compact it"

Claude reads the current content, summarizes it, then calls `bindery_memory_compact`
with the compacted text. The original is automatically backed up to
`.bindery/memories/archive/global_YYYY-MM-DD.md` before the file is overwritten.

### Spot-check a chapter translation

> "Compare chapter 10 in EN and NL and flag any translation issues"

Claude calls `bindery_get_chapter` twice — once for EN, once for NL — then calls
`bindery_get_translation` with the target language to load the known term table.
Discrepancies are presented in a side-by-side table. Any confirmed corrections
are saved back with `bindery_add_translation` (glossary) or `bindery_add_dialect` (dialect substitutions).

### Check continuity across chapters

> "Check chapter 8 for consistency errors — character descriptions and world rules"

Claude calls `bindery_get_book_until` to load prior chapters through the focus chapter,
uses `bindery_get_notes` to load character profiles and world rules, then uses `bindery_search`
to verify specific details against earlier chapters. Results are presented in a
table with issue type, location, and the reference that contradicts it.

## Tools reference

| Tool | What it does |
|---|---|
| `bindery_list_books` | List all configured book names |
| `bindery_identify_book` | Match a working directory to a book name |
| `bindery_health` | Server status: settings, index, embedding backend, and latest release availability |
| `bindery_download_latest_mcp` | Download and unpack latest standalone MCP ZIP into `BINDERY_MCP_LOCATION` (not for Claude `.mcpb` installs) |
| `bindery_init_workspace` | Create or update `.bindery/settings.json`, `translations.json`, generated `.bindery/README.md`, and the opinionated Arc / Notes / Characters / SESSION / PREFERENCES / memory scaffold |
| `bindery_setup_ai_files` | Generate AI instruction files (CLAUDE.md, copilot-instructions.md, .cursor/rules, AGENTS.md), Claude skill templates, and refresh generated `.bindery/README.md` |
| `bindery_index_build` | Build or rebuild the lexical index and, when enabled, the semantic embedding index |
| `bindery_index_status` | Show lexical and semantic index status, build times, and stale hints |
| `bindery_get_text` | Read any file by relative path, with optional line range |
| `bindery_get_chapter` | Full chapter content by number and language |
| `bindery_get_book_until` | Chapters from a start chapter through N (inclusive), concatenated in order |
| `bindery_get_overview` | Chapter structure — acts, chapters, titles |
| `bindery_get_notes` | Notes/ files, filterable by category or name |
| `bindery_note_list` | List story note files under the configured notes folder |
| `bindery_note_get` | Read a single story note by path relative to the notes folder |
| `bindery_note_create` | Create a story note under the configured notes folder |
| `bindery_note_append` | Append markdown content to a story note, creating it if needed |
| `bindery_character_list` | List structured character profile files |
| `bindery_character_get` | Read a structured character profile by name |
| `bindery_character_create` | Create a character profile and update the character index |
| `bindery_character_update` | Update a character profile and refresh the character index row |
| `bindery_arc_list` | List structured arc files |
| `bindery_arc_get` | Read a structured arc file |
| `bindery_arc_create` | Create an arc file and update the arc index |
| `bindery_arc_update` | Update an arc file and refresh the arc index |
| `bindery_search` | Search in lexical, semantic-rerank, or full-semantic mode; semantic modes fall back to lexical with warnings |
| `bindery_format` | Apply typography formatting to a file or folder |
| `bindery_get_review_text` | Git diff of uncommitted changes plus any `<!-- Bindery: Review start/stop -->` marker regions; optional auto-staging consumes the markers |
| `bindery_update_workspace` | Fetch and pull the current branch, with branch/default-branch reporting |
| `bindery_git_snapshot` | Commit changes in bindery workspace, with optional push |
| `bindery_get_translation` | List glossary entries for a language, or look up a specific term (forgiving) |
| `bindery_add_translation` | Add or update a cross-language glossary entry (agent reference) |
| `bindery_get_dialect` | List dialect substitution rules, or look up a specific word |
| `bindery_add_dialect` | Add or update a dialect substitution rule (auto-applied at export) |
| `bindery_add_language` | Add a language to settings.json and scaffold the story folder with stubs |
| `bindery_settings_update` | Deep-merge a partial patch into settings.json without replacing unrelated keys |
| `bindery_memory_list` | List memory files with line counts |
| `bindery_memory_append` | Append a dated session entry to a memory file |
| `bindery_memory_compact` | Overwrite a memory file with a summary (backs up original) |
| `bindery_session_focus_get` | Read working state from `SESSION.md` (optionally a single section: Current Focus, Next Actions, Open Questions, Handoff Notes) |
| `bindery_session_focus_update` | Update neutral `SESSION.md` sections (replace or append); leaves `PREFERENCES.md` and other content untouched |
| `bindery_inbox_process` | Enumerate `Notes/Inbox.md` items with stable numbers and propose destinations — read-only, never moves or categorizes |
| `bindery_inbox_resolve` | Remove already-routed inbox items by number after confirmation; preserves other items and the heading/intro |

Current boundary: Arc, character, note, memory, session-focus, and inbox-triage workflows are available through MCP tools, with matching VS Code and Obsidian host command wrappers. `bindery_session_focus_update` touches only the neutral `SESSION.md` sections; `PREFERENCES.md` is user-owned and never tool-written. `bindery_inbox_process` only proposes and `bindery_inbox_resolve` only removes named items — route confirmed items with the destination tools first.

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

For standalone MCP clients, release CI also produces `bindery-mcp-server-<version>.zip` containing `server/index.js` and setup instructions.

## Files

- `manifest.json` — Extension metadata, tool declarations, user config schema
- `server/` — Populated by CI with the compiled mcp-ts server
- `icon.svg` — Extension icon
