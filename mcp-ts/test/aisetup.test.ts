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

async function loadTemplates() {
  vi.resetModules();
  return import('../src/templates');
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

  it('does not overwrite legacy zip files that already exist', async () => {
    const { setupAiFiles } = await loadAiSetup();

    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({
      bookTitle: 'Test Book',
      storyFolder: 'Story',
      languages: [{ code: 'EN', folderName: 'EN' }],
    }, null, 2) + '\n');

    write(path.join(root, '.claude', 'skills', 'read-aloud.zip'), 'legacy zip bytes');

    setupAiFiles({
      root,
      targets: ['claude'],
      skills: ['read-aloud'],
      overwrite: true,
    });
   
    expect(fs.readFileSync(path.join(root, '.claude', 'skills', 'read-aloud.zip'), 'utf-8')).toBe('legacy zip bytes');
  });

  it('generates requested skill markdown files for agents target under .agents/skills', async () => {
    const { setupAiFiles } = await loadAiSetup();

    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({
      bookTitle: 'Test Book',
      storyFolder: 'Story',
      languages: [{ code: 'EN', folderName: 'EN' }],
    }, null, 2) + '\n');

    const result = setupAiFiles({
      root,
      targets: ['agents'],
      skills: ['read-in'],
      overwrite: true,
    });

    expect(result.regenerated).toContain('.agents/skills/read-in/SKILL.md');
    expect(fs.existsSync(path.join(root, '.agents', 'skills', 'read-in', 'SKILL.md'))).toBe(true);
  });

  it('includes .agents skill files in expected AI version entries', async () => {
    const { expectedAiVersionEntries } = await loadAiSetup();
    const { FILE_VERSION_INFO } = await loadTemplates();

    const expected = expectedAiVersionEntries();
    const claudeKey = '.claude/skills/read-in/SKILL.md';
    const agentsKey = '.agents/skills/read-in/SKILL.md';

    expect(expected[agentsKey]).toEqual(expected[claudeKey]);
    expect(expected[agentsKey]).toEqual({
      version: FILE_VERSION_INFO[claudeKey].version,
      label: FILE_VERSION_INFO[claudeKey].label,
    });
  });

  it('regenerates .agents skill file when stamped version is stale and overwrite is false', async () => {
    const { setupAiFiles, readAiVersionFile } = await loadAiSetup();

    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({
      bookTitle: 'Test Book',
      storyFolder: 'Story',
      languages: [{ code: 'EN', folderName: 'EN' }],
    }, null, 2) + '\n');

    setupAiFiles({
      root,
      targets: ['agents'],
      skills: ['read-in'],
      overwrite: true,
    });

    const versionPath = path.join(root, '.bindery', 'ai-version.json');
    const raw = JSON.parse(fs.readFileSync(versionPath, 'utf-8')) as {
      versions: Record<string, { version: number; label: string }>;
    };
    raw.versions['.agents/skills/read-in/SKILL.md'].version = 0;
    fs.writeFileSync(versionPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');

    const second = setupAiFiles({
      root,
      targets: ['agents'],
      skills: ['read-in'],
      overwrite: false,
    });

    expect(second.regenerated).toContain('.agents/skills/read-in/SKILL.md');

    const stamped = readAiVersionFile(root);
    expect(stamped.versions['.agents/skills/read-in/SKILL.md'].version).toBeGreaterThan(0);
  });
});
