import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

describe('mcp index contract', () => {
  it('every registered tool has exactly one annotation hint', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'index.ts'), 'utf-8');

    const registerCount = (source.match(/server\.registerTool\(/g) ?? []).length;
    const singleHintCount = (source.match(/annotations:\s*\{\s*(readOnlyHint|destructiveHint):\s*true\s*\}/g) ?? []).length;

    expect(registerCount).toBeGreaterThan(0);
    expect(singleHintCount).toBe(registerCount);

    const hasBothHints = /annotations:\s*\{[^}]*readOnlyHint:\s*true[^}]*destructiveHint:\s*true[^}]*\}/s.test(source)
      || /annotations:\s*\{[^}]*destructiveHint:\s*true[^}]*readOnlyHint:\s*true[^}]*\}/s.test(source);

    expect(hasBothHints).toBe(false);
  });
});
