import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnSyncMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

const tempRoots: string[] = [];
const originalPlatform = process.platform;

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-aisetup-test-'));
  tempRoots.push(root);
  return root;
}

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

async function loadAiSetup() {
  vi.resetModules();
  return import('../src/aisetup');
}

afterEach(() => {
  spawnSyncMock.mockReset();
  Object.defineProperty(process, 'platform', {
    value: originalPlatform,
    configurable: true,
  });
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('setupAiFiles zip generation', () => {
  it('falls back to zip on Windows when pwsh fails', async () => {
    setPlatform('win32');
    const { setupAiFiles } = await loadAiSetup();

    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({
      bookTitle: 'Test Book',
      storyFolder: 'Story',
      languages: [{ code: 'EN', folderName: 'EN' }],
    }, null, 2) + '\n');

    spawnSyncMock
      .mockReturnValueOnce({ status: 1, error: undefined })
      .mockImplementationOnce((_command: string, args: string[]) => {
        const tmpZip = args[1];
        fs.writeFileSync(tmpZip, 'PK\u0003\u0004read_aloud/SKILL.md', 'latin1');
        return { status: 0, error: undefined };
      });

    const result = setupAiFiles({
      root,
      targets: ['claude'],
      skills: ['read_aloud'],
      overwrite: true,
    });

    expect(spawnSyncMock.mock.calls[0]?.[0]).toBe('pwsh');
    expect(spawnSyncMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ cwd: path.join(root, '.claude', 'skills'), encoding: 'utf-8' })
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      2,
      'zip',
      expect.arrayContaining(['-r', expect.stringContaining('read_aloud.zip'), 'read_aloud']),
      expect.objectContaining({ cwd: path.join(root, '.claude', 'skills'), encoding: 'utf-8' })
    );
    expect(result.skillZipManifest.created).toContain('.claude/skills/read_aloud.zip');
    expect(result.skillZipManifest.failed).toEqual([]);

    const zipPath = path.join(root, '.claude', 'skills', 'read_aloud.zip');
    expect(fs.existsSync(zipPath)).toBe(true);
    expect(fs.readFileSync(zipPath, 'latin1')).toContain('read_aloud/SKILL.md');
  });

  it('reports failed skill zips when both Windows zip commands fail', async () => {
    setPlatform('win32');
    const { setupAiFiles } = await loadAiSetup();

    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({
      bookTitle: 'Test Book',
      storyFolder: 'Story',
      languages: [{ code: 'EN', folderName: 'EN' }],
    }, null, 2) + '\n');

    spawnSyncMock
      .mockReturnValueOnce({ status: 1, error: undefined })
      .mockReturnValueOnce({ status: 1, error: undefined });

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