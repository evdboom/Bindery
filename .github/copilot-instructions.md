# GitHub Copilot — Bindery

Bindery is a **VS Code extension** + **MCP server** for markdown book authoring.
TypeScript throughout. Two independent packages — keep them in sync when adding features.

---

## Repo layout

```
vscode-ext/        ← VS Code extension (published to Marketplace)
  src/
    extension.ts   ← activation, all commands, format-on-save handler
    workspace.ts   ← reads/writes .bindery/settings.json + translations.json
    merge.ts       ← chapter discovery, markdown assembly, pandoc/LibreOffice
    format.ts      ← typography transforms (curly quotes, em-dash, ellipsis)
    mcp.ts         ← vscode.lm.registerTool registrations + mcp.json writer
    ai-setup.ts    ← generates CLAUDE.md, copilot-instructions.md, skills, etc.

mcp-ts/            ← Standalone MCP server (also bundled inside vscode-ext)
  src/
    index.ts       ← McpServer entry point, all server.registerTool() calls
    tools.ts       ← one exported function per tool (pure: root + args → string)
    registry.ts    ← book registry (--book flags + BINDERY_BOOKS env var)
    search.ts      ← BM25 index build/load/search + optional Ollama reranking
    docstore.ts    ← file discovery and chunking
    format.ts      ← typography (shared logic, duplicated from vscode-ext)

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
- **Config priority**: `.bindery/settings.json` → VS Code workspace settings → VS Code user settings → code defaults
- **Machine paths only in user settings**: `pandocPath`, `libreOfficePath` — never in workspace settings
- **Substitution tiers**: built-in (`merge.ts`) → user-general (`bindery.generalSubstitutions`) → project (`.bindery/translations.json`). Later tiers win.
- **formatOnSave**: only fires for files inside the configured `storyFolder`
- **Activation**: `onStartupFinished` (to ensure LM tools register at launch) + `onLanguage:markdown`
- **Command namespace**: all commands are `bindery.*` — must match in both `package.json` and `extension.ts`

## VS Code extension — commands

| Command | Description |
|---|---|
| `bindery.init` | Create `.bindery/settings.json` + `translations.json` |
| `bindery.setupAI` | Generate CLAUDE.md / copilot-instructions.md / skills / AGENTS.md |
| `bindery.formatDocument` / `bindery.formatFolder` | Typography formatting |
| `bindery.mergeMarkdown/Docx/Epub/Pdf/All` | Merge chapters → output format |
| `bindery.findProbableUsToUkWords` | Surface probable US spellings in EN source |
| `bindery.addDialect` | Add a dialect substitution rule (auto-applied at export) |
| `bindery.addTranslation` | Add a cross-language glossary entry |
| `bindery.addLanguage` | Add a new language and scaffold its story folder |
| `bindery.addUkReplacement` | Alias for `addDialect` (backward compat) |
| `bindery.openTranslations` | Open translations.json |
| `bindery.registerMcp` | Write .vscode/mcp.json for Claude/Codex MCP discovery |

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
`FILE_VERSION_INFO` in `mcp-ts/src/templates.ts` is a per-file version table/map (a Record keyed by output path) that controls staleness detection.

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
# MCP server
cd mcp-ts && npm run build          # outputs to mcp-ts/out/

# VS Code extension
cd vscode-ext && npm run compile    # outputs to vscode-ext/out/

# Type-check only (no emit)
cd mcp-ts    && npx tsc --noEmit
cd vscode-ext && npx tsc --noEmit
```

Before releasing mcpb: copy `mcp-ts/out/` → `mcpb/server/`.

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
