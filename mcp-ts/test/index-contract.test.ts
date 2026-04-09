import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

describe('mcp index contract', () => {
  it('every registered tool has exactly one annotation hint', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'index.ts'), 'utf-8');

    const registerCount = (source.match(/server\.registerTool\(/g) ?? []).length;

    // Count annotations that contain readOnlyHint or destructiveHint (may also contain openWorldHint)
    const hasReadOnly = (source.match(/annotations:\s*\{[^}]*readOnlyHint:\s*true[^}]*\}/gs) ?? []).length;
    const hasDestructive = (source.match(/annotations:\s*\{[^}]*destructiveHint:\s*true[^}]*\}/gs) ?? []).length;

    expect(registerCount).toBeGreaterThan(0);
    expect(hasReadOnly + hasDestructive).toBe(registerCount);

    const hasBothHints = /annotations:\s*\{[^}]*readOnlyHint:\s*true[^}]*destructiveHint:\s*true[^}]*\}/s.test(source)
      || /annotations:\s*\{[^}]*destructiveHint:\s*true[^}]*readOnlyHint:\s*true[^}]*\}/s.test(source);

    expect(hasBothHints).toBe(false);
  });

  it('tools that send data to Ollama declare openWorldHint: true', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'index.ts'), 'utf-8');

    // Find the annotation block for each Ollama-capable tool and verify openWorldHint: true
    const ollamaTools = ['search', 'retrieve_context'];
    for (const toolName of ollamaTools) {
      // Match registerTool('search', { ... annotations: { ... } ... })
      const toolBlockMatch = new RegExp(
        `server\\.registerTool\\('${toolName}',[\\s\\S]*?annotations:\\s*\\{([^}]*)\\}`,
      ).exec(source);
      expect(toolBlockMatch, `Tool '${toolName}' not found in index.ts`).not.toBeNull();
      const annotationsBody = toolBlockMatch![1];
      expect(annotationsBody, `Tool '${toolName}' should have openWorldHint: true`).toMatch(/openWorldHint:\s*true/);
    }
  });

  it('tools that do not use Ollama do not declare openWorldHint: true', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'index.ts'), 'utf-8');

    const ollamaToolNames = ['search', 'retrieve_context'];

    // Extract all registerTool blocks and check non-Ollama tools lack openWorldHint
    const toolBlockRegex = /server\.registerTool\('([^']+)'[\s\S]*?annotations:\s*\{([^}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = toolBlockRegex.exec(source)) !== null) {
      const name = match[1];
      const annotationsBody = match[2];
      if (!ollamaToolNames.includes(name)) {
        expect(
          /openWorldHint:\s*true/.test(annotationsBody),
          `Tool '${name}' should NOT have openWorldHint: true`,
        ).toBe(false);
      }
    }
  });
});
