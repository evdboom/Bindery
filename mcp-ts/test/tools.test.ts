import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  toolGetChapter,
  toolGetText,
  toolIndexBuild,
  toolSearch,
} from '../src/tools';

const tempRoots: string[] = [];

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-mcp-test-'));
  tempRoots.push(root);
  return root;
}

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

afterEach(() => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('mcp tools', () => {
  it('prevents path traversal in get_text', () => {
    const root = makeRoot();
    write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\ninside\n');
    write(path.join(path.dirname(root), 'secret.txt'), 'outside');

    const result = toolGetText(root, { identifier: '../secret.txt' });
    expect(result).toContain('File not found');
  });

  it('finds a chapter file recursively by chapter number', () => {
    const root = makeRoot();
    write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# One\nAlpha\n');
    write(path.join(root, 'Story', 'EN', 'Act II', 'Chapter 2.md'), '# Two\nBeta\n');

    const result = toolGetChapter(root, { chapterNumber: 2, language: 'en' });
    expect(result).toContain('# Two');
    expect(result).toContain('Beta');
  });

  it('builds index and returns search results', async () => {
    const root = makeRoot();
    write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Arrival\nThe red comet crossed the sky.\n');

    const build = toolIndexBuild(root);
    expect(build).toContain('Index built:');

    const result = await toolSearch(root, { query: 'red comet', language: 'EN', maxResults: 3 });
    expect(result).toContain('Chapter 1.md');
    expect(result).toContain('red comet');
  });
});
