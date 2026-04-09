import * as fs from 'node:fs';
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempRoots: string[] = [];

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-aisetup-test-'));
  tempRoots.push(root);
  return root;
}

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

async function loadAiSetup() {
  vi.resetModules();
  return import('../src/aisetup');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unmock('fflate');
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('setupAiFiles zip generation', () => {
  it('builds skill zips in-process with normalized entry paths', async () => {
    const { setupAiFiles } = await loadAiSetup();

    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({
      bookTitle: 'Test Book',
      storyFolder: 'Story',
      languages: [{ code: 'EN', folderName: 'EN' }],
    }, null, 2) + '\n');

    const result = setupAiFiles({
      root,
      targets: ['claude'],
      skills: ['read_aloud'],
      overwrite: true,
    });

    expect(result.skillZipManifest.created).toContain('.claude/skills/read_aloud.zip');
    expect(result.skillZipManifest.failed).toEqual([]);

    const zipPath = path.join(root, '.claude', 'skills', 'read_aloud.zip');
    expect(fs.existsSync(zipPath)).toBe(true);

    const zipText = fs.readFileSync(zipPath, 'latin1');
    expect(zipText).toContain('read_aloud/SKILL.md');
    expect(zipText).not.toContain('read_aloud\\SKILL.md');
  });

  it('reports a failed skill zip when archive generation throws', async () => {
    vi.doMock('fflate', async () => {
      const actual = await vi.importActual<typeof import('fflate')>('fflate');
      return {
        ...actual,
        zipSync: () => {
          throw new Error('zip failed');
        },
      };
    });
    const { setupAiFiles } = await loadAiSetup();

    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({
      bookTitle: 'Test Book',
      storyFolder: 'Story',
      languages: [{ code: 'EN', folderName: 'EN' }],
    }, null, 2) + '\n');

    const result = setupAiFiles({
      root,
      targets: ['claude'],
      skills: ['read_aloud'],
      overwrite: true,
    });

    expect(result.skillZipManifest.failed).toContain('.claude/skills/read_aloud.zip');
    expect(result.skillZipManifest.created).toEqual([]);
    expect(fs.existsSync(path.join(root, '.claude', 'skills', 'read_aloud.zip'))).toBe(false);
  });
});
