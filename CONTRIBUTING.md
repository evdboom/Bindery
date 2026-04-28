# Contributing to Bindery

Thank you for contributing! This document explains how to run the tests and what CI requires before a pull request can be merged.

---

## Running Tests Locally

### Quick test (both packages)

```bash
cd mcp-ts && npm test
cd ../vscode-ext && npm test
```

### Watch mode (auto-rerun on file change)

```bash
# Terminal 1
cd mcp-ts && npm run test:watch

# Terminal 2
cd vscode-ext && npm run test:watch
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
| **MCP unit tests** | `mcp-ts/test/tools.test.ts` | Tool logic, path safety, search indexing |
| **MCP contract tests** | `mcp-ts/test/index-contract.test.ts` | Every registered tool has exactly one annotation hint |
| **MCP stdio integration** | `mcp-ts/test/integration-stdio.test.ts` | Spawn real server, JSON-RPC handshake, tool calls, path-traversal defence, error handling |
| **VS Code unit tests** | `vscode-ext/test/workspace.test.ts`, `vscode-ext/test/mcp.test.ts` | Workspace helpers, MCP JSON writer |
| **VS Code integration** | `vscode-ext/test/integration-commands.test.ts` | Init workflow, registerMcp, formatDocument, settings precedence |

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

The workflow runs on every push and pull request on all branches.

A single `test` job runs the steps sequentially (the template-sync step must
occur between the mcp-ts and vscode-ext builds):

| Step | What it does |
|---|---|
| Install + compile mcp-ts | `npm ci` → `npm run compile` |
| Run mcp-ts tests | `npm run test:ci` → uploads `test-results.json` artifact |
| Sync templates | Copies `mcp-ts/src/templates.ts` → `vscode-ext/src/ai-setup-templates.ts` |
| Install + compile vscode-ext | `npm ci` → `npm run compile` |
| Run vscode-ext tests | `npm run test:ci` → uploads `test-results.json` artifact |

PRs **cannot be merged** unless the `test` job passes.

---

## Adding New Tests

1. Add your test file alongside the existing ones (`mcp-ts/test/` or `vscode-ext/test/`).
2. Follow the naming convention: `<feature>.test.ts` for unit tests, `integration-<area>.test.ts` for integration tests.
3. Run `npm test` locally before pushing.
4. For MCP stdio integration tests that spawn a child process, always register a `kill()` call in `afterEach` to prevent orphaned processes.

---

## Future Enhancements

- E2E tests with real pandoc/LibreOffice invocation
- Cross-platform CI matrix (Windows, macOS)
- Code coverage reporting and threshold enforcement
