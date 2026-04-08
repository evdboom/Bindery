/**
 * Copy-parity test: vscode-ext/src/ai-setup-templates.ts must be an exact copy
 * of mcp-ts/src/templates.ts (the single source of truth).
 *
 * - If the copy is absent  → test is skipped with an actionable message.
 * - If the copy is present but differs → test fails (CI will always have it synced).
 *
 * To sync locally:
 *   cp mcp-ts/src/templates.ts vscode-ext/src/ai-setup-templates.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT   = path.resolve(__dirname, '..', '..');
const SOURCE_FILE = path.join(REPO_ROOT, 'mcp-ts',     'src', 'templates.ts');
const COPY_FILE   = path.join(REPO_ROOT, 'vscode-ext', 'src', 'ai-setup-templates.ts');

describe('templates copy-parity', () => {
  it('vscode-ext/src/ai-setup-templates.ts is an exact copy of mcp-ts/src/templates.ts', () => {
    if (!fs.existsSync(COPY_FILE)) {
      // Skip gracefully in local dev when the copy has not been generated yet.
      // In CI the sync step runs before tests, so this branch should never be hit there.
      console.warn(
        '\n[SKIP] vscode-ext/src/ai-setup-templates.ts is missing.\n' +
        'Run the sync step to generate it:\n' +
        '  cp mcp-ts/src/templates.ts vscode-ext/src/ai-setup-templates.ts\n',
      );
      return;
    }

    const source = fs.readFileSync(SOURCE_FILE, 'utf-8');
    const copy   = fs.readFileSync(COPY_FILE,   'utf-8');

    expect(copy, [
      'vscode-ext/src/ai-setup-templates.ts has drifted from mcp-ts/src/templates.ts.',
      'Re-sync it with:',
      '  cp mcp-ts/src/templates.ts vscode-ext/src/ai-setup-templates.ts',
    ].join('\n')).toBe(source);
  });
});
