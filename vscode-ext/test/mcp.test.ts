import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
  return {
    workspace: {
      getConfiguration: () => ({
        get: (key: string) => (key === 'ollamaUrl' ? 'http://127.0.0.1:11434' : undefined),
      }),
    },
  };
});

import { writeMcpJson } from '../src/mcp';

const tempRoots: string[] = [];

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-vscode-mcp-test-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('writeMcpJson', () => {
  it('writes bindery server config and preserves existing servers', async () => {
    const root = makeRoot();
    const mcpDir = path.join(root, '.vscode');
    const mcpJsonPath = path.join(mcpDir, 'mcp.json');
    fs.mkdirSync(mcpDir, { recursive: true });
    fs.writeFileSync(
      mcpJsonPath,
      JSON.stringify({ servers: { other: { command: 'node', args: ['x.js'] } } }, null, 2),
      'utf-8',
    );

    await writeMcpJson({ extensionPath: '/fake/ext' } as never, root);

    const parsed = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8')) as {
      servers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
    };

    expect(parsed.servers.other).toBeDefined();
    expect(parsed.servers.bindery.command).toBe('node');
    expect(parsed.servers.bindery.args[1]).toBe('--book');
    expect(parsed.servers.bindery.args[2]).toContain(`${path.basename(root)}=${root}`);
    expect(parsed.servers.bindery.env?.BINDERY_OLLAMA_URL).toBe('http://127.0.0.1:11434');
  });
});
