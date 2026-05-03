# Contributing to Bindery

Thank you for contributing! This document explains how to run the tests and what CI requires before a pull request can be merged.

---

## Running Tests Locally

### Quick test (all packages)

```bash
npm test  # runs all packages in parallel
```

Or test individual packages:

```bash
npm run test --workspace=bindery-core
npm run test --workspace=bindery-merge
npm run test --workspace=mcp-ts
npm run test --workspace=vscode-ext
npm run test --workspace=obsidian-plugin
```

### Watch mode (auto-rerun on file change)

```bash
# Terminal 1
npm run test:watch --workspace=bindery-core

# Terminal 2
npm run test:watch --workspace=bindery-merge

# Terminal 3
npm run test:watch --workspace=mcp-ts

# Terminal 4
npm run test:watch --workspace=vscode-ext

# Terminal 5
npm run test:watch --workspace=obsidian-plugin
```

### CI reporter (as GitHub Actions runs it)

```bash
cd mcp-ts && npm run test:ci
cd ../vscode-ext && npm run test:ci
```

The `test:ci` script writes a `test-results.json` file in each package directory that GitHub Actions uploads as a workflow artifact.

---

## Test Coverage

| Layer | Location | What is tested |
|---|---|---|
| **bindery-core unit tests** | `bindery-core/test/` | Templates, settings, translations, formatting logic |
| **bindery-merge unit tests** | `bindery-merge/test/merge.test.ts` | Pure merge functions, chapter discovery, dialect conversion |
| **bindery-merge mocked tests** | `bindery-merge/test/merge-mocked.test.ts` | Pandoc/LibreOffice paths (with child_process mocked) |
| **bindery-merge extended tests** | `bindery-merge/test/merge-extended.test.ts` | Internal functions, Pandoc helpers, typography integration |
| **MCP unit tests** | `mcp-ts/test/tools.test.ts` | Tool logic, path safety, search indexing |
| **MCP contract tests** | `mcp-ts/test/index-contract.test.ts` | Every registered tool has exactly one annotation hint |
| **MCP stdio integration** | `mcp-ts/test/integration-stdio.test.ts` | Spawn real server, JSON-RPC handshake, tool calls, path-traversal defence, error handling |
| **VS Code unit tests** | `vscode-ext/test/workspace.test.ts`, `vscode-ext/test/mcp.test.ts` | Workspace helpers, MCP JSON writer |
| **VS Code integration** | `vscode-ext/test/integration-commands.test.ts` | Init workflow, registerMcp, formatDocument, settings precedence |
| **Obsidian plugin tests** | `obsidian-plugin/test/` | Plugin lifecycle, workspace management, AI setup, merge execution, formatter integration |
| **Obsidian exporter** | `obsidian-plugin/test/exporter.test.ts` | Export orchestration, multi-format output |
| **Obsidian merge** | `obsidian-plugin/test/merge.test.ts` | Chapter discovery, dialect handling, Obsidian Vault API integration |

---

## Test Ownership Policy

To keep tests maintainable as packages grow, place tests where the production code
lives:

1. **Unit tests live in the owning package.**
	 - Example: template rendering logic in `bindery-core/src/templates/**` should be
		 tested primarily in `bindery-core/test/`.
2. **Cross-package tests validate wiring, contracts, and integration only.**
	 - Example: `mcp-ts` should keep a thin shim/contract test for re-exports, not
		 duplicate full behavior suites owned by `bindery-core`.
3. **Coverage exclusions should reflect testability, not ownership drift.**
	 - Do not exclude files from package coverage solely because tests were placed in
		 a different package.

---

## Host Feature Parity Policy

**Feature parity is complete.** Both `vscode-ext/` and `obsidian-plugin/` implement
identical Bindery authoring workflows:

- **Shared logic**: All merge, export, tool-location, and typography logic lives in
  `bindery-merge/` and is consumed by both hosts.
- **Equivalent commands**: Both hosts provide all 17+ authoring commands (format,
  merge, AI setup, workspace management, dialect/translation/language management).
- **Equivalent tests**: Each host has a full test suite covering its command wiring
  and host-specific integration (Obsidian Vault API, VS Code Workspace API).

Unless a feature is **explicitly host-specific** (e.g., VS Code's Language Model Tool API),
any functional change or bug fix added to one host must be implemented in the other
host in the same PR.

When adding or changing commands:
- **Update logic**: If logic lives in `bindery-merge/` or `bindery-core/`, update there once
- **Update command wiring**: Update in both `vscode-ext/src/extension.ts` and `obsidian-plugin/src/main.ts`
- **Add tests**: Add to both host test suites to validate host-specific integration
- **Document exceptions**: Clearly note any intentional host-specific behavior in the PR description

---

## MCP stdio integration tests (`mcp-ts/test/integration-stdio.test.ts`)

These tests spawn `node out/index.js` as a real child process and drive it over
stdin/stdout using the MCP JSON-RPC protocol.

**Prerequisites:** run `npm run build` in `mcp-ts/` before running these tests. The
CI workflow does this automatically (`build` step runs before `test:ci`), but when
running locally you must build first.

**Security note:** The tests use OS temporary directories created by `mkdtempSync`
and never accept user-controlled paths, eliminating path-injection risk.

---

## VS Code extension integration tests (`vscode-ext/test/integration-commands.test.ts`)

These tests exercise the full command-level workflows of the extension by calling
the underlying helper functions directly (no extension-host required). The VS Code
APIs are mocked via `vi.mock('vscode', ...)`.

Tests cover:
- `bindery.init` — creates `.bindery/settings.json` and `translations.json`
- `bindery.registerMcp` — generates `.vscode/mcp.json` with the correct server config
- `bindery.formatDocument` — applies typography transforms (curly quotes, em-dash, ellipsis)
- Settings precedence (workspace file overrides defaults)

---

## CI pipeline (`.github/workflows/ci.yml`)

The workflow runs on every push and pull request on all branches, on all three major platforms
(Ubuntu, Windows, macOS).

A single `test` job runs the build and test steps sequentially:

| Step | What it does |
|---|---|
| Install all workspace deps | `npm ci` |
| Build + test bindery-core | `npm run build` → `npm run test:ci` → uploads `test-results.json` |
| Build + test bindery-merge | `npm run build` → `npm run test:ci` → uploads `test-results.json` |
| Compile + test mcp-ts | `npm run compile` → `npm run test:ci` → uploads `test-results.json` |
| Compile + test vscode-ext | `npm run compile` → `npm run test:ci` (+ VSIX smoke check on ubuntu-latest) |
| Compile + test obsidian-plugin | `npm run compile` → `npm run bundle` → `npm run test:ci` → uploads `test-results.json` |

A separate `coverage` job runs on ubuntu-latest only (coverage metrics don't vary by OS):

| Step | What it does |
|---|---|
| Build + coverage for each package | `npm run compile` → `npm run test:coverage` |
| Upload coverage reports | Artifacts collected for each package |

**PRs cannot be merged** unless the `test` job passes on all platforms.

---

## Adding New Tests

1. Add your test file alongside the existing ones (`mcp-ts/test/` or `vscode-ext/test/`).
2. Follow the naming convention: `<feature>.test.ts` for unit tests, `integration-<area>.test.ts` for integration tests.
3. Run `npm test` locally before pushing.
4. For MCP stdio integration tests that spawn a child process, always register a `kill()` call in `afterEach` to prevent orphaned processes.

---

## Troubleshooting

### Merge tests won't compile
The merge tests have moved from `vscode-ext/test/` to `bindery-merge/test/`. If you have
local references to the old paths, update imports to point to `bindery-merge` instead.

### CI passes locally but fails in GitHub Actions
Ensure your `package-lock.json` was generated with the same npm major version as the one
used in `.github/workflows/ci.yml`. This prevents lockfile skew across platforms.

---

## Future Enhancements

- E2E tests with real pandoc/LibreOffice invocation
- Code coverage reporting dashboards
- Per-commit performance benchmarks (merge speed, search latency)
