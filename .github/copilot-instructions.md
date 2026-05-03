# GitHub Copilot — Bindery

Bindery is an open-source suite for markdown book authoring with **feature parity** across hosts:
- **VS Code extension** (published to Marketplace) — full-featured IDE integration
- **Obsidian plugin** — fully-featured Obsidian integration
- **MCP server** (Claude Desktop, Cursor, etc.) — standalone server for AI assistants

TypeScript throughout. Shared logic in `bindery-merge/` and `bindery-core/`; hosts consume
the shared libraries and add their own host-specific wiring. Keep implementations in sync.

---

## Repo layout

```
bindery-core/      ← Shared templates, settings, typography, translations
  src/
    templates/     ← AI setup instruction templates (per-host)
    index.ts       ← exports shared types and helpers
    settings.ts    ← Bindery workspace settings schema and helpers
    formatting.ts  ← typography transforms (shared across all hosts)
    translations.ts ← dialect and glossary management

bindery-merge/     ← Shared merge logic (chapter discovery, export orchestration)
  src/
    merge.ts       ← mergeBook() — main export orchestrator (950+ lines)
    tool-locate.ts ← platform-aware path resolution for pandoc, libreoffice (250+ lines)
    index.ts       ← barrel exports for public API
    format.ts      ← typography helpers (used during merge)

vscode-ext/        ← VS Code extension (published to Marketplace)
  src/
    extension.ts   ← activation, all 17+ commands, format-on-save handler
    workspace.ts   ← reads/writes .bindery/settings.json + translations.json
    merge.ts       ← re-exports from @bindery/merge (pure delegation)
    format.ts      ← typography transforms via @bindery/core
    mcp.ts         ← vscode.lm.registerTool registrations + mcp.json writer
    ai-setup.ts    ← generates per-target instruction files
  mcp-ts/          ← bundled copy of mcp-ts/out/ (for packaging)

Obsidian-plugin/   ← Obsidian plugin (Community Plugins marketplace)
  src/
    main.ts        ← activation, all 17+ commands (feature parity with vscode-ext)
    workspace.ts   ← Vault I/O, settings management (Obsidian-specific)
    merge.ts       ← Obsidian-specific wrapper around @bindery/merge
    ai-setup.ts    ← per-target instruction file generation
    formatter.ts   ← typography formatting via @bindery/core
    exporter.ts    ← export orchestration (Obsidian-specific UI)

mcp-ts/            ← Standalone MCP server (Claude Desktop, Cursor, etc.)
  src/
    index.ts       ← McpServer entry point, all server.registerTool() calls
    tools.ts       ← one exported function per tool (pure: root + args → string)
    registry.ts    ← book registry (--book flags + BINDERY_BOOKS env var)
    search.ts      ← BM25 index build/load/search + optional Ollama reranking
    docstore.ts    ← file discovery and chunking
    format.ts      ← typography (shared with @bindery/core)

mcpb/              ← Claude Desktop extension package (mcpb manifest + bundled server)
  manifest.json    ← mcpb manifest v0.3 — tools list, user_config, privacy_policies
  server/          ← bundled output (copy of mcp-ts/out/) — DO NOT hand-edit
```

---

## MCP server — rules for every tool change

The MCP server is published to the Anthropic MCPB directory. These rules are hard requirements to stay publishable.

### Every tool MUST have the correct annotations
Readonly/destructive are mutually exclusive categories that determine how the tool is presented to users and whether it can be called by read-only agents. Every tool MUST have exactly one of these annotations:
```typescript
annotations: { readOnlyHint: true }    // reads only — never writes files
annotations: { destructiveHint: true } // writes, creates, or modifies files
```
Tools that call external tools/api (eg Ollama) should be annotated with the openWorldHint, but this is required for MCPB submission in addition to one of the above, eg a readonly tool that calls an external search API would have:
```typescript
annotations: { readOnlyHint: true, openWorldHint: true }     // reads only — never writes files, calls external API or tool
```

No annotation = mcpb submission rejection. 

| Tool behavior | Annotation |
|---|---|
| list, get, read, search, status checks | `readOnlyHint: true` |
| write, append, overwrite, format, commit, create | `destructiveHint: true` |
| calls external API or tool (eg search API) | `openWorldHint: true` (in addition to one of the above) |

### Adding a new tool — checklist
When adding a tool, touch **all four** of these: missing any breaks one surface.

1. **`mcp-ts/src/tools.ts`** — add the implementation function (`toolXxx(root, args): string`)
2. **`mcp-ts/src/index.ts`** — `server.registerTool(...)` with Zod schema, description, and ONE annotation
3. **`vscode-ext/src/mcp.ts`** — `vscode.lm.registerTool('bindery_xxx', ...)` + add input interface + add to `McpTools`
4. **`vscode-ext/package.json`** — add entry to `languageModelTools[]` with JSON Schema input
5. **`mcpb/manifest.json`** — add `{ "name": "xxx", "description": "..." }` to `tools[]`

### mcpb manifest rules
- `manifest_version` must stay `"0.3"` or higher
- `privacy_policies` array must contain a valid HTTPS URL — do not remove it
- `tools[]` is a flat list of `{ name, description }` — one entry per tool, no inputSchema here
- The `server/` folder is a bundled copy of `mcp-ts/out/` — update it when releasing

---

## MCP tools reference

see `mcp-ts/src/index.ts` for implementation details and input schemas and `mcpb/README.md` for user-facing descriptions.

---

## VS Code extension — key design rules

- **Generic**: no project-specific strings in source (use "Book", not a title)
- **Host-agnostic logic**: Shared logic lives in `bindery-merge/` and `bindery-core/`; hosts re-export or wrap
- **Config priority**: `.bindery/settings.json` → host-specific settings → code defaults
- **Machine paths only in user settings**: `pandocPath`, `libreOfficePath` — never in workspace settings
- **Substitution tiers**: built-in (from `@bindery/merge`) → user-general → project (`.bindery/translations.json`). Later tiers win.
- **formatOnSave**: only fires for files inside the configured `storyFolder`
- **Activation**: `onStartupFinished` (to ensure LM tools register at launch) + `onLanguage:markdown`
- **Command namespace**: all commands are `bindery.*` — must match in both `package.json` and `extension.ts`

## Authoring commands (feature parity across hosts)

Both VS Code and Obsidian plugins expose these equivalent commands (identical functionality,
host-specific UI/activation):

| Command | VS Code | Obsidian | Description |
|---|---|---|---|
| `bindery.init` | ✅ | ✅ | Create `.bindery/settings.json` + `translations.json` |
| `bindery.setupAI` | ✅ | ✅ | Generate CLAUDE.md / copilot-instructions.md / skills / AGENTS.md |
| `bindery.formatDocument` | ✅ | ✅ | Typography formatting (curly quotes, em-dash, ellipsis) |
| `bindery.formatFolder` | ✅ | ✅ | Recursively format all .md files in a folder |
| `bindery.mergeMarkdown` | ✅ | ✅ | Merge chapters → .md |
| `bindery.mergeDocx` | ✅ | ✅ | Merge chapters → .docx (via pandoc) |
| `bindery.mergeEpub` | ✅ | ✅ | Merge chapters → .epub (via pandoc) |
| `bindery.mergePdf` | ✅ | ✅ | Merge chapters → .pdf (via pandoc + LibreOffice) |
| `bindery.mergeAll` | ✅ | ✅ | Merge chapters → all supported formats |
| `bindery.findProbableUsToUkWords` | ✅ | ✅ | Surface probable US spellings in EN source |
| `bindery.addDialect` | ✅ | ✅ | Add a dialect substitution rule (auto-applied at export) |
| `bindery.addTranslation` | ✅ | ✅ | Add a cross-language glossary entry |
| `bindery.addLanguage` | ✅ | ✅ | Add a new language and scaffold its story folder |
| `bindery.openTranslations` | ✅ | ✅ | Show path to translations.json (edit in host editor) |
| `bindery.registerMcp` | ✅ | — | Write .vscode/mcp.json for Claude/Codex MCP discovery (VS Code-only) |
| `bindery.showMcpConfig` | — | ✅ | Display MCP configuration snippet (Obsidian-only) |

---

## AI setup (`ai-setup.ts`)

`setupAiFiles()` generates per-target instruction files. Each target is independent.

| Target | Output |
|---|---|
| `claude` | `CLAUDE.md` + `.claude/skills/<skill>/SKILL.md` for each selected skill |
| `copilot` | `.github/copilot-instructions.md` |
| `cursor` | `.cursor/rules` |
| `agents` | `AGENTS.md` |

Skills: `review`, `brainstorm`, `memory`, `translate`, `translation-review`, `status`, `continuity`, `read-aloud`, `read-in`, `proof-read`.

The **memory skill** uses `memory_list` → `memory_append` → `memory_compact`. Do not fall back to `get_text` + Edit tool for memory writes.

### AI setup versioning
`FILE_VERSION_INFO` in `bindery-core/src/templates.ts` is a per-file version table/map (a Record keyed by output path) that controls staleness detection.

- `setupAiFiles()` stamps `.bindery/ai-version.json` with the current version of each file after every run.
- On extension activation, if `.bindery/settings.json` exists and a stamped version is older than the one in `FILE_VERSION_INFO`, the user is notified and offered an "Update now" button that opens `bindery.setupAI`.
- **Bump `FILE_VERSION_INFO` for the changed template by 1 whenever it changed significantly** (i.e. existing users should regenerate). Small copy fixes do not require a bump.

---

## Memory system

Memory files live in `.bindery/memories/` inside the book root.
- `global.md` — cross-chapter decisions
- `chXX.md` — per-chapter notes (e.g. `ch10.md`)
- `archive/` — compacted originals (auto-created by `memory_compact`)

Format of an appended entry (stamped by `memory_append`, not the caller):
```
## Session YYYY-MM-DD — [title]
[content lines]
```

---

## Build

```bash
# Individual packages
npm run build --workspace=bindery-core        # outputs to bindery-core/out/
npm run build --workspace=bindery-merge       # outputs to bindery-merge/out/
npm run compile --workspace=mcp-ts            # outputs to mcp-ts/out/
npm run compile --workspace=vscode-ext        # outputs to vscode-ext/out/
npm run compile --workspace=obsidian-plugin   # outputs to obsidian-plugin/out/

# All packages at once
npm run build  # builds bindery-core, bindery-merge, compiles all others

# Type-check only (no emit)
npx tsc --noEmit
```

### Release workflow

**For MCPB (Claude Desktop):**
1. `npm run build --workspace=mcp-ts`
2. Copy `mcp-ts/out/` → `mcpb/server/`
3. Update `mcpb/manifest.json` version
4. Submit to Anthropic MCPB directory

**For VS Code Marketplace:**
1. `npm run compile --workspace=vscode-ext`
2. Bundle mcp-ts into vscode-ext:
   ```bash
   mkdir -p vscode-ext/mcp-ts/out
   npx esbuild mcp-ts/out/tools.js --bundle --platform=node --format=cjs --target=node18 --outfile=vscode-ext/mcp-ts/out/tools.js
   npx esbuild mcp-ts/out/index.js --bundle --platform=node --format=cjs --target=node18 --outfile=vscode-ext/mcp-ts/out/index.js
   ```
3. Package VSIX: `cd vscode-ext && npx @vscode/vsce package`
4. Upload to Marketplace

**For Obsidian Community Plugins:**
1. `npm run compile --workspace=obsidian-plugin`
2. `npm run bundle --workspace=obsidian-plugin` (outputs bundled main.js to `obsidian-plugin/out/`)
3. Testing: copy `obsidian-plugin/` to Obsidian vault plugins folder:
   ```
   ~/.obsidian/plugins/bindery/   (on Linux/macOS)
   %APPDATA%\\Obsidian\\plugins\\bindery\\  (on Windows)
   ```
4. Submit PR to Obsidian Community Plugins repo

# Hygiene rules for generated files

- Keep generated files small and focused.
- Prefer splitting responsibilities over growing a single file; aim for roughly <= 400 lines per file unless there is a clear reason not to.
- Test behavior, not just happy paths.
- Include at least one non-happy-path test for new behavior (for example: invalid input, edge case, failure path, or regression case).
- Choose test level intentionally:
  - unit tests for pure logic,
  - integration tests for tool wiring / file IO / command flows,
  - end-to-end only when cross-surface behavior must be validated.
- If full test coverage is not feasible, explicitly document what was not tested and why.
- When updating packages, always regenerate lock files with the same npm major used by CI so contributors do not create lockfiles that CI cannot read.
