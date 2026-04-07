# Claude — Bindery Extension Development

## What this is
The **Bindery** VS Code extension — a generic markdown book-authoring tool.
TypeScript, VS Code extension API. Located in `_src/vscode-ext/`.

## Architecture
```
src/
  extension.ts   ← activation, all commands, format-on-save handler
  workspace.ts   ← reads/writes .bindery/settings.json and .bindery/translations.json
  merge.ts       ← chapter discovery, markdown assembly, pandoc/LibreOffice invocation
  format.ts      ← typography transforms (curly quotes, em-dash, ellipsis)
```

## Key design rules
- **Generic**: no project-specific strings in source. Default strings like “Book”, not project names.
- **Config priority**: `.bindery/settings.json` → VS Code workspace settings → VS Code user settings → code defaults.
- **Machine paths only in VS Code settings**: `pandocPath`, `libreOfficePath` are never in the workspace file.
- **Substitution tiers**: built-in (merge.ts) → user-general (`bindery.generalSubstitutions`) → project (`.bindery/translations.json`). Later tiers win.
- **formatOnSave scope**: only fires for files inside the configured `storyFolder`.

## Workspace config files (`.bindery/`)
| File | Purpose |
|---|---|
| `settings.json` | Book metadata, project paths, language configs |
| `translations.json` | Per-language substitution rules (`type: substitution`) and glossaries (`type: glossary`) |

## Translation entry types
- `substitution` — auto-applied during export (word-by-word, e.g. US→UK).
- `glossary` — reference only, not auto-applied (e.g. EN→NL term table).

## Commands (all prefixed `bindery.`)
| Command | Description |
|---|---|
| `init` | Create `.bindery/settings.json` + `translations.json` |
| `formatDocument` / `formatFolder` | Apply typography formatting |
| `mergeMarkdown/Docx/Epub/Pdf/All` | Merge chapters and export |
| `findProbableUsToUkWords` | Scan EN source and surface US spellings |
| `addDialect` | Add a dialect substitution rule (auto-applied at export, e.g. US→UK) |
| `addTranslation` | Add a cross-language glossary entry (agent reference, not auto-applied) |
| `addLanguage` | Add a new language to settings.json and scaffold its story folder |
| `addUkReplacement` | Alias for `addDialect` (backward compat) |

## When suggesting changes
- Prefer editing the smallest surface area possible.
- Check that all command IDs match the `bindery.*` namespace throughout `package.json` AND `extension.ts`.
- Test mentally: does the new behavior respect the config priority order?
