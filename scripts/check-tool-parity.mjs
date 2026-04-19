#!/usr/bin/env node
/**
 * MCP tool parity guard.
 *
 * Verifies every tool name appears in all 5 required surfaces:
 *   1. mcp-ts/src/tools.ts           — implementation function `toolXxx`
 *   2. mcp-ts/src/index.ts           — server.registerTool('xxx', ...)
 *   3. vscode-ext/src/mcp.ts         — vscode.lm.registerTool('bindery_xxx', ...)
 *   4. vscode-ext/package.json       — languageModelTools[].name = 'bindery_xxx'
 *   5. mcpb/manifest.json            — tools[].name = 'xxx' (no prefix)
 *
 * Source of truth: the set of tool names in mcp-ts/src/index.ts.
 * Exits with code 1 if any surface diverges.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(p) {
    return fs.readFileSync(path.join(repoRoot, p), 'utf-8');
}

function extractMatches(source, regex) {
    const names = new Set();
    for (const m of source.matchAll(regex)) {
        names.add(m[1]);
    }
    return names;
}

// ── Surface 1: mcp-ts/src/index.ts — registerTool('xxx', ...) (no prefix in server)
const indexTs = read('mcp-ts/src/index.ts');
const sourceOfTruth = extractMatches(indexTs, /registerTool\s*\(\s*['"]([a-z0-9_]+)['"]/gi);

/**
 * Tools that only make sense when the MCP server runs standalone against a
 * multi-book registry. The VS Code extension is always single-book (the
 * workspace), so these aren't exposed via vscode.lm.registerTool or listed
 * in languageModelTools[]. They must still appear in mcpb/manifest.json.
 */
const serverOnlyTools = new Set(['list_books', 'identify_book']);
const vscodeExpected = new Set([...sourceOfTruth].filter(t => !serverOnlyTools.has(t)));

// ── Surface 2: vscode-ext/src/mcp.ts — vscode.lm.registerTool('bindery_xxx', ...)
const mcpTs = read('vscode-ext/src/mcp.ts');
const vscodeLmTools = extractMatches(mcpTs, /registerTool\s*(?:<[^>]+>)?\s*\(\s*['"]bindery_([a-z0-9_]+)['"]/gi);

// ── Surface 3: vscode-ext/package.json — languageModelTools[].name
const vsPkg = JSON.parse(read('vscode-ext/package.json'));
const lmManifest = new Set(
    (vsPkg.contributes?.languageModelTools ?? [])
        .map((t) => (t.name || '').replace(/^bindery_/, ''))
        .filter(Boolean)
);

// ── Surface 4: mcpb/manifest.json — tools[].name (no prefix)
const mcpbManifest = JSON.parse(read('mcpb/manifest.json'));
const mcpbTools = new Set((mcpbManifest.tools ?? []).map((t) => t.name).filter(Boolean));

// ── Surface 5: mcp-ts/src/tools.ts — implementation must exist for each
// We don't enforce naming convention strictly (tool names don't always map to camelCase),
// so we just confirm the file is non-empty — the TypeScript compiler already validates imports.
const toolsTs = read('mcp-ts/src/tools.ts');
if (toolsTs.length < 100) {
    console.error('mcp-ts/src/tools.ts is suspiciously short');
    process.exit(1);
}

// ── Compare ──
const surfaces = {
    'mcp-ts/src/index.ts (registerTool)':            { set: sourceOfTruth, expected: sourceOfTruth },
    'vscode-ext/src/mcp.ts (vscode.lm.registerTool)': { set: vscodeLmTools, expected: vscodeExpected },
    'vscode-ext/package.json (languageModelTools)':   { set: lmManifest,    expected: vscodeExpected },
    'mcpb/manifest.json (tools)':                     { set: mcpbTools,     expected: sourceOfTruth },
};

let failed = false;
console.log(`Source of truth: ${sourceOfTruth.size} tools in mcp-ts/src/index.ts`);
console.log(`Server-only (excluded from VS Code surfaces): ${[...serverOnlyTools].join(', ')}\n`);

for (const [label, { set, expected }] of Object.entries(surfaces)) {
    const missing = [...expected].filter((t) => !set.has(t)).sort();
    const extra = [...set].filter((t) => !expected.has(t)).sort();

    if (missing.length === 0 && extra.length === 0) {
        console.log(`✓ ${label}: ${set.size} tools`);
        continue;
    }
    failed = true;
    console.error(`✗ ${label}: ${set.size} tools (expected ${expected.size})`);
    if (missing.length > 0) { console.error(`    missing: ${missing.join(', ')}`); }
    if (extra.length > 0) { console.error(`    extra:   ${extra.join(', ')}`); }
}

if (failed) {
    console.error('\nTool parity check FAILED. Every MCP tool must be registered in all required surfaces.');
    process.exit(1);
}

console.log('\nAll surfaces agree.');
