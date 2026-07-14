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
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('setupAiFiles skill generation', () => {
  it('generates requested skill markdown files for claude target', async () => {
    const { setupAiFiles } = await loadAiSetup();

    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({
      bookTitle: 'Test Book',
      storyFolder: 'Story',
      languages: [{ code: 'EN', folderName: 'EN' }, { code: 'NL', folderName: 'NL' }],
    }, null, 2) + '\n');

    const result = setupAiFiles({
      root,
      targets: ['claude'],
      skills: ['translation-review'],
      overwrite: true,
    });

    expect(result.regenerated).toContain('.claude/skills/translation-review/SKILL.md');
    expect(fs.existsSync(path.join(root, '.claude', 'skills', 'translation-review', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.claude', 'skills', 'translation-review.zip'))).toBe(false);
  });

  it('returns an empty skill zip manifest (zips are no longer generated)', async () => {
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
      skills: ['read-aloud'],
      overwrite: true,
    });

    expect(result.skillZipManifest.created).toEqual([]);
    expect(result.skillZipManifest.rebuilt).toEqual([]);
    expect(result.skillZipManifest.skipped).toEqual([]);
    expect(result.skillZipManifest.failed).toEqual([]);
  });

  it('does not overwrite legacy zip files that already exist', async () => {
    const { setupAiFiles } = await loadAiSetup();

    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({
      bookTitle: 'Test Book',
      storyFolder: 'Story',
      languages: [{ code: 'EN', folderName: 'EN' }],
    }, null, 2) + '\n');

    write(path.join(root, '.claude', 'skills', 'read-aloud.zip'), 'legacy zip bytes');

    const result = setupAiFiles({
      root,
      targets: ['claude'],
      skills: ['read-aloud'],
      overwrite: true,
    });

    expect(result.skillZipManifest.failed).toEqual([]);
    expect(result.skillZipManifest.created).toEqual([]);
    expect(fs.readFileSync(path.join(root, '.claude', 'skills', 'read-aloud.zip'), 'utf-8')).toBe('legacy zip bytes');
  });
});
