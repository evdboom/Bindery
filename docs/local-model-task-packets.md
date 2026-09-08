# Local Model Task Packets

These packets are ordered for testing the workflow. Start with Packet 1, review the
local model's diff and validation discipline, then increase scope.

## Packet 1: Optional word counts in book overview [DONE]

**Outcome:** `bindery_get_overview` can optionally include per-file and aggregate word
counts so an author or status skill can assess manuscript size without reading every
chapter.

**Why:** The existing overview reports structure, titles, and numbering gaps. The
status and read-in skills discuss progress, but there is no cheap structured manuscript
size signal.

**Starting points:**

- `mcp-ts/src/tools.ts`: `GetOverviewArgs`, `toolGetOverview`, `actLines`, and
  `topLevelLines`.
- `mcp-ts/test/content-tools.test.ts`: existing `toolGetOverview` tests.
- `mcp-ts/src/index.ts`: `bindery_get_overview` registration.
- `vscode-ext/src/mcp.ts` and `vscode-ext/package.json`: matching LM tool input.

**Scope:**

- Add optional `includeWordCounts?: boolean`, defaulting to `false`.
- When enabled, append `N words` to each listed Markdown file.
- Add an act subtotal, a top-level subtotal when applicable, and a language total.
- Count prose with one documented, Unicode-aware rule. Headings count as words;
  Markdown punctuation does not. Keep the helper pure and unit-test it through output.
- Update the MCP and VS Code schemas/descriptions for the new optional input.
- Update `mcpb/manifest.json` only if its description needs to advertise the feature.

**Non-goals:**

- Do not add targets, deadlines, reading-time estimates, UI commands, or settings.
- Do not change output when `includeWordCounts` is absent or false.
- Do not add a new tool.

**Acceptance criteria:**

- Existing overview tests pass unchanged.
- Enabled output reports correct counts for ASCII and non-ASCII prose.
- Top-level files and act files are both included in the language total.
- An act filter reports totals only for content visible under that filter.
- Empty files report zero without throwing.
- The option is present in standalone MCP and VS Code LM schemas.

**Validation:**

```bash
npm run test --workspace=mcp-ts -- content-tools.test.ts
npm run compile --workspace=mcp-ts
npm run compile --workspace=vscode-ext
node scripts/check-tool-parity.mjs
```

**Stop conditions:** Stop and report if the current overview has a machine-readable
contract or snapshot not visible in the named tests, or if adding the VS Code input
requires changing a host command.

## Packet 2: Reproducible merge and search benchmarks [DONE]

**Outcome:** Contributors can run one command that records repeatable local timings for
Markdown merge, lexical index build, and lexical search against a generated fixture.

**Why:** `CONTRIBUTING.md` lists per-commit merge and search benchmarks as future work.
Start with a stable local harness before adding CI thresholds or dashboards.

**Starting points:**

- `bindery-merge/src/index.ts`: public merge API.
- `mcp-ts/src/search.ts`: public index and search functions.
- Root `package.json`: repository scripts.
- Existing merge and search tests for minimal valid workspace fixtures.

**Scope:**

- Add `scripts/benchmark.mjs` using Node built-ins only.
- Generate a deterministic temporary book with configurable chapter count and words
  per chapter; use conservative defaults that finish quickly on a laptop.
- Build required packages before running through the root `benchmark` script.
- Measure Markdown-only merge, lexical index build, and repeated lexical queries with
  `performance.now()`.
- Print environment metadata, fixture dimensions, warmup count, sample count, median,
  and p95 as JSON so results can be compared or archived.
- Always delete the temporary workspace in `finally`.
- Document invocation and interpretation in `CONTRIBUTING.md`.

**Non-goals:**

- Do not benchmark Pandoc, LibreOffice, Ollama, semantic embeddings, or host startup.
- Do not add dependencies, CI jobs, pass/fail thresholds, or committed result files.
- Do not optimize production code as part of this packet.

**Acceptance criteria:**

- `npm run benchmark` succeeds from the repository root on Windows, macOS, and Linux.
- Two runs use equivalent fixture content and emit the same JSON shape.
- The output includes Node version and platform plus all three operation timings.
- Temporary files are removed on success and on a forced operation failure.
- Invalid numeric CLI options exit non-zero with a concise message.

**Validation:**

```bash
npm run benchmark
npm run lint
```

**Stop conditions:** Stop and report if the built package APIs cannot be imported from
the root without relying on unpublished internals. Propose the smallest public export
needed, but do not add it without approval.

## Packet 3: Extract translation tools from the MCP monolith [DONE]

**Outcome:** Translation, dialect, and language tool implementations live in one
focused module while all imports and public behavior remain compatible.

**Why:** `mcp-ts/src/tools.ts` is the largest source file in the repository. A staged
domain extraction reduces context cost and merge conflicts without attempting a risky
whole-file rewrite.

**Starting points:**

- `mcp-ts/src/tools.ts`: blocks from `get_translation` through `add_language` and
  their directly used private helpers/types.
- `mcp-ts/test/translations-tools.test.ts`.
- `mcp-ts/src/index.ts`: imports from `./tools.js` that must remain valid.

**Scope:**

- Add `mcp-ts/src/tools-translations.ts`, targeting fewer than 400 lines.
- Move only translation, dialect, and language implementations plus helpers used
  exclusively by that domain.
- Re-export the moved functions and argument types from `mcp-ts/src/tools.ts` so
  current consumers do not change.
- If a generic helper is shared, extract the smallest helper to a clearly named
  internal module; do not duplicate parsing or path-safety logic.
- Preserve messages, file formats, sync behavior, and exported signatures exactly.

**Non-goals:**

- Do not add features, rename tools, alter schemas, or edit generated output.
- Do not split any second domain in the same change.
- Do not reformat unrelated sections of `tools.ts`.

**Acceptance criteria:**

- Translation tool tests pass without assertion changes.
- `mcp-ts/src/index.ts` and VS Code's bundled-tool consumer compile without import
  changes.
- The new module is under 400 lines unless the final report identifies a concrete
  cohesion reason.
- `tools.ts` has materially fewer lines and remains the compatibility barrel.
- Tool parity and annotation contract tests remain green.

**Validation:**

```bash
npm run test --workspace=mcp-ts -- translations-tools.test.ts
npm run compile --workspace=mcp-ts
npm run test --workspace=mcp-ts
npm run compile --workspace=vscode-ext
node scripts/check-tool-parity.mjs
```

**Stop conditions:** Stop and report if the block depends on more than three unrelated
private helper groups, or if preserving the `./tools.js` exports creates a runtime
cycle. Return a dependency list for frontier replanning instead of widening the edit.

## Later backlog

These ideas merit frontier planning after the first three packets establish how the
local model behaves:

- Export preflight report shared by both hosts: planned inputs/outputs, missing tools, cover/image warnings, and no writes.
- Real Pandoc/LibreOffice E2E tests behind explicit environment detection.
- A coverage summary published in pull requests from existing V8 reports.
- Incremental extraction of notes, characters/arcs, git/review, and session-memory domains from `mcp-ts/src/tools.ts`, one independently validated packet at a time.
- An author-facing continuity audit that composes existing search, arc, character, and chapter data before introducing new storage formats.