import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearLocateCache, locateTool, locateToolPath } from '../src/tool-locate';

const tempDirs: string[] = [];

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-locate-test-'));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  clearLocateCache();
});

afterEach(() => {
  clearLocateCache();
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('locateTool', () => {
  it('prefers explicit setting when the file exists', () => {
    const dir = makeDir();
    const fakePandoc = path.join(dir, process.platform === 'win32' ? 'pandoc.exe' : 'pandoc');
    fs.writeFileSync(fakePandoc, '');

    const result = locateTool('pandoc', fakePandoc);
    expect(result.path).toBe(fakePandoc);
    expect(result.source).toBe('setting');
  });

  it('returns the literal setting even when the file is missing (surfaces clear error to user)', () => {
    const dir = makeDir();
    const missing = path.join(dir, 'does-not-exist.exe');

    const result = locateTool('pandoc', missing);
    expect(result.path).toBe(missing);
    expect(result.source).toBe('setting');
  });

  it('treats empty string and default command as "unset"', () => {
    const r1 = locateTool('pandoc', '');
    const r2 = locateTool('pandoc', 'pandoc');
    expect(['path', 'default', 'fallback']).toContain(r1.source);
    expect(['path', 'default', 'fallback']).toContain(r2.source);
  });

  it('falls back to the command name when nothing is found', () => {
    // Use a tool name but force an obviously bogus setting that doesn't exist.
    // If nothing is on PATH / well-known locations on this machine for libreoffice,
    // the fallback source should kick in. We can't force the environment,
    // so just assert the shape: a non-empty path is always returned.
    const result = locateTool('libreoffice', undefined);
    expect(typeof result.path).toBe('string');
    expect(result.path.length).toBeGreaterThan(0);
  });

  it('locateToolPath returns the same string as locateTool.path', () => {
    const setting = 'pandoc';
    expect(locateToolPath('pandoc', setting)).toBe(locateTool('pandoc', setting).path);
  });

  it('caches repeated lookups', () => {
    const dir = makeDir();
    const fake = path.join(dir, process.platform === 'win32' ? 'pandoc.exe' : 'pandoc');
    fs.writeFileSync(fake, '');

    const r1 = locateTool('pandoc', fake);
    // Delete the file — cached result should still be returned
    fs.rmSync(fake);
    const r2 = locateTool('pandoc', fake);
    expect(r2.path).toBe(r1.path);
  });

  it('clearLocateCache forces fresh resolution on next call', () => {
    const dir = makeDir();
    const fake = path.join(dir, process.platform === 'win32' ? 'pandoc.exe' : 'pandoc');
    fs.writeFileSync(fake, '');

    locateTool('pandoc', fake);
    clearLocateCache();
    // After clearing cache, the same call should still resolve (file still exists)
    const result = locateTool('pandoc', fake);
    expect(result.path).toBe(fake);
    expect(result.source).toBe('setting');
  });

  it('resolves libreoffice with explicit setting', () => {
    const dir = makeDir();
    const fakePath = path.join(dir, process.platform === 'win32' ? 'soffice.exe' : 'soffice');
    fs.writeFileSync(fakePath, '');

    const result = locateTool('libreoffice', fakePath);
    expect(result.path).toBe(fakePath);
    expect(result.source).toBe('setting');
  });

  it('treats "libreoffice" as default setting (triggers auto-detect)', () => {
    const result = locateTool('libreoffice', 'libreoffice');
    expect(['path', 'default', 'fallback']).toContain(result.source);
  });

  it('treats "soffice" as default setting for libreoffice (triggers auto-detect)', () => {
    const result = locateTool('libreoffice', 'soffice');
    expect(['path', 'default', 'fallback']).toContain(result.source);
  });

  it('returns fallback for pandoc when no setting and nothing on PATH or well-known', () => {
    // On a system where pandoc is not installed, this would return fallback
    // On a system where it IS installed, it returns path/default — both valid
    const result = locateTool('pandoc', undefined);
    expect(typeof result.path).toBe('string');
    expect(result.path.length).toBeGreaterThan(0);
    expect(['path', 'default', 'fallback']).toContain(result.source);
  });

  it('returns setting source when path exists but is NOT a known default', () => {
    const dir = makeDir();
    const customPath = path.join(dir, 'my-custom-pandoc');
    fs.writeFileSync(customPath, '');

    const result = locateTool('pandoc', customPath);
    expect(result.path).toBe(customPath);
    expect(result.source).toBe('setting');
  });

  it('returns setting source even for non-existent custom path (to surface clear error)', () => {
    const result = locateTool('pandoc', '/some/custom/path/to/pandoc');
    expect(result.path).toBe('/some/custom/path/to/pandoc');
    expect(result.source).toBe('setting');
  });

  it('cache uses different entries for pandoc vs libreoffice', () => {
    const dir = makeDir();
    const fakePandoc = path.join(dir, 'custom-pandoc');
    const fakeSoffice = path.join(dir, 'custom-soffice');
    fs.writeFileSync(fakePandoc, '');
    fs.writeFileSync(fakeSoffice, '');

    const pandocResult = locateTool('pandoc', fakePandoc);
    const libreResult = locateTool('libreoffice', fakeSoffice);

    expect(pandocResult.path).toBe(fakePandoc);
    expect(libreResult.path).toBe(fakeSoffice);
    expect(pandocResult.path).not.toBe(libreResult.path);
  });

  it('re-resolves when setting changes from default to explicit', () => {
    // First: resolve with default (auto-detect)
    locateTool('pandoc', '');

    clearLocateCache();

    // Second: resolve with explicit path
    const dir = makeDir();
    const explicit = path.join(dir, 'explicit-pandoc');
    fs.writeFileSync(explicit, '');
    const result = locateTool('pandoc', explicit);

    expect(result.path).toBe(explicit);
    expect(result.source).toBe('setting');
  });
});
