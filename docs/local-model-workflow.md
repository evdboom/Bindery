# Frontier-to-Local Development Workflow

Use a frontier model for repository review, product decisions, and task design. Use a
local model for bounded implementation after the decisions have been written down.

## Fast repository orientation

A local model does not need to scan the entire repository. At the start of a task,
give it the task packet and ask it to read only:

1. `.github/copilot-instructions.md` for architecture, parity rules, and validation.
2. The files named under **Starting points** in the task packet.
3. The nearest existing test for the behavior being changed.

`CLAUDE.md` largely duplicates the Copilot instructions and is useful for other hosts,
but a Copilot provider does not need to read both. `README.md` and `CONTRIBUTING.md`
are reference material, not required startup context unless the task changes public
behavior or CI.

## Handoff prompt

Use this prompt with a local GitHub Copilot provider:

```text
Implement the task packet below in this repository.

Read only the packet's starting points and the nearest relevant tests. State one local hypothesis and the cheapest check that can disprove it. Make the smallest implementation that satisfies the acceptance criteria.

Do not broaden the task, refactor unrelated code, edit generated bundles, or change public behavior listed under non-goals. Preserve VS Code/Obsidian/MCP parity where the packet requires it. After the first edit, run the packet's focused validation. Fix failures caused by the change; report unrelated failures without fixing them.

Return: changed files, acceptance criteria met, commands run with results, and any
remaining risk or assumption.

[PASTE ONE TASK PACKET HERE]
```

## Packet quality bar

Every task handed to a local model should contain:

- **Outcome**: one observable result, not a broad aspiration.
- **Why**: enough product context to resolve small implementation choices.
- **Starting points**: owning source plus one nearby test or call site.
- **Scope** and **non-goals**: explicit boundaries.
- **Acceptance criteria**: behavior that can be checked without interpretation.
- **Validation**: a narrow command first, then parity or wider checks if needed.
- **Stop conditions**: assumptions whose failure should return the task for replanning.

Prefer packets that change one ownership area and fit in one context window. Split a
cross-host feature into shared logic first and host wiring second only when each step
is independently buildable and tested.

## Repository routing

| Change | Primary owner | First validation |
|---|---|---|
| Settings, templates, typography, translations | `bindery-core/` | `npm run test --workspace=bindery-core` |
| Chapter discovery, images, export orchestration | `bindery-merge/` | `npm run test --workspace=bindery-merge` |
| MCP tool implementation or registration | `mcp-ts/` | `npm run test --workspace=mcp-ts` |
| VS Code host wiring | `vscode-ext/` | `npm run compile --workspace=vscode-ext` |
| Obsidian host wiring | `obsidian-plugin/` | `npm run compile --workspace=obsidian-plugin` |
| New or renamed MCP tool | MCP plus all published surfaces | `node scripts/check-tool-parity.mjs` |
| New or renamed host command | VS Code and Obsidian | `node scripts/check-command-parity.mjs` |

For a new MCP tool, the five published surfaces are `mcp-ts/src/tools.ts`,
`mcp-ts/src/index.ts`, `vscode-ext/src/mcp.ts`, `vscode-ext/package.json`, and
`mcpb/manifest.json`. Every registered tool must have exactly one of
`readOnlyHint` or `destructiveHint`; add `openWorldHint` when it calls an external
service.

## Review loop

1. Ask the local model to implement one packet on a fresh branch or clean worktree.
2. Inspect its summary and diff before giving it another packet.
3. Run the packet's wider validation if the local model only ran the focused check.
4. Return ambiguous requirements or architecture changes to the frontier model.
5. Record any repeated local-model mistake in the next packet's constraints rather
   than making every model rescan the repository.

Good frontier work reduces decisions left to the executor. Good local execution
produces a small diff whose correctness is visible from tests and acceptance criteria.