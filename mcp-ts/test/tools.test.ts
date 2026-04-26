import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  toolGetChapter,
  toolGetBookUntil,
  toolGetText,
  toolIndexBuild,
  toolSettingsUpdate,
  toolSearch,
  toolHealth,
  toolSetupAiFiles,
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

  it('returns concatenated chapter text from chapter 1 through N', () => {
    const root = makeRoot();
    write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# One\nAlpha\n');
    write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 2.md'), '# Two\nBeta\n');

    const result = toolGetBookUntil(root, { chapterNumber: 2, language: 'en' });
    expect(result).toContain('BEGIN CHAPTER 1');
    expect(result).toContain('# One');
    expect(result).toContain('BEGIN CHAPTER 2');
    expect(result).toContain('# Two');
  });

  it('coerces a non-integer startChapter to an integer range start', () => {
    const root = makeRoot();
    write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# One\nAlpha\n');
    write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 2.md'), '# Two\nBeta\n');
    write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 3.md'), '# Three\nGamma\n');

    const result = toolGetBookUntil(root, { chapterNumber: 3, startChapter: 2.9, language: 'en' });
    expect(result).toContain('BEGIN CHAPTER 2');
    expect(result).toContain('BEGIN CHAPTER 3');
    expect(result).not.toContain('BEGIN CHAPTER 1');
  });

  it('clamps negative non-integer startChapter values to chapter 1', () => {
    const root = makeRoot();
    write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# One\nAlpha\n');
    write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 2.md'), '# Two\nBeta\n');

    const result = toolGetBookUntil(root, { chapterNumber: 2, startChapter: -1.5, language: 'en' });
    expect(result).toContain('BEGIN CHAPTER 1');
    expect(result).toContain('BEGIN CHAPTER 2');
  });

  it('returns a clear error when a chapter in range is missing', () => {
    const root = makeRoot();
    write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# One\nAlpha\n');
    write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 3.md'), '# Three\nGamma\n');

    const result = toolGetBookUntil(root, { chapterNumber: 3, language: 'en' });
    expect(result).toBe('Chapter 2 not found in EN');
  });

  it('deep-merges partial settings patches without replacing unrelated keys', () => {
    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({
      bookTitle: 'Test Book',
      proof_read: {
        enabled: true,
        options: { mode: 'quick', preserve: true },
      },
      storyFolder: 'Story',
    }, null, 2) + '\n');

    const update = toolSettingsUpdate(root, {
      patch: {
        proof_read: {
          authors: [{ name: 'Author A', known_for: 'X', reads_for: 'Y' }],
          options: { mode: 'full' },
        },
      },
    });

    expect(update).toContain('Updated .bindery/settings.json');

    const settings = JSON.parse(fs.readFileSync(path.join(root, '.bindery', 'settings.json'), 'utf-8')) as {
      proof_read?: {
        enabled?: boolean;
        authors?: Array<{ name: string }>;
        options?: { mode?: string; preserve?: boolean };
      };
      storyFolder?: string;
    };

    expect(settings.storyFolder).toBe('Story');
    expect(settings.proof_read?.enabled).toBe(true);
    expect(settings.proof_read?.options?.mode).toBe('full');
    expect(settings.proof_read?.options?.preserve).toBe(true);
    expect(settings.proof_read?.authors?.[0]?.name).toBe('Author A');
  });

  it('ignores unsafe prototype-pollution keys in settings_update patches', () => {
    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({
      bookTitle: 'Test Book',
      storyFolder: 'Story',
      proof_read: { enabled: true },
    }, null, 2) + '\n');

    const patch = JSON.parse('{"proof_read":{"enabled":false},"__proto__":{"polluted":"yes"}}') as Record<string, unknown>;
    const update = toolSettingsUpdate(root, { patch });
    expect(update).toContain('Updated .bindery/settings.json');

    const settings = JSON.parse(fs.readFileSync(path.join(root, '.bindery', 'settings.json'), 'utf-8')) as {
      proof_read?: { enabled?: boolean };
      __proto__?: unknown;
    };
    expect(settings.proof_read?.enabled).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(settings, '__proto__')).toBe(false);
    expect(({} as { polluted?: string }).polluted).toBeUndefined();
  });

  it('ignores constructor and prototype keys in settings_update patches', () => {
    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({
      bookTitle: 'Test Book',
      storyFolder: 'Story',
      proof_read: { enabled: true },
    }, null, 2) + '\n');

    const patch = JSON.parse('{"proof_read":{"enabled":false},"constructor":{"evil":1},"prototype":{"evil":2}}') as Record<string, unknown>;
    const update = toolSettingsUpdate(root, { patch });
    expect(update).toContain('Updated .bindery/settings.json');

    const settings = JSON.parse(fs.readFileSync(path.join(root, '.bindery', 'settings.json'), 'utf-8')) as {
      proof_read?: { enabled?: boolean };
      constructor?: unknown;
      prototype?: unknown;
    };
    expect(settings.proof_read?.enabled).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(settings, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(settings, 'prototype')).toBe(false);
  });

  it('returns an error when all patch keys are unsafe', () => {
    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({ bookTitle: 'Test Book', storyFolder: 'Story' }, null, 2) + '\n');

    const patch = JSON.parse('{"__proto__":{"evil":1},"constructor":{"evil":2}}') as Record<string, unknown>;
    const result = toolSettingsUpdate(root, { patch });
    expect(result).toContain('Error');
    expect(result).toContain('no safe keys');
  });

  it('only reports actually-merged keys in success message', () => {
    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({ bookTitle: 'Test Book', storyFolder: 'Story' }, null, 2) + '\n');

    const patch = JSON.parse('{"bookTitle":"New Title","__proto__":{"evil":1}}') as Record<string, unknown>;
    const result = toolSettingsUpdate(root, { patch });
    expect(result).toContain('bookTitle');
    expect(result).not.toContain('__proto__');
  });

  it('builds index and returns search results', async () => {
    const root = makeRoot();
    write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Arrival\nThe red comet crossed the sky.\n');

    const build = await toolIndexBuild(root);
    expect(build).toContain('Lexical index built:');

    const result = await toolSearch(root, { query: 'red comet', language: 'EN', maxResults: 3 });
    expect(result).toContain('Chapter 1.md');
    expect(result).toContain('red comet');
  });

  it('setup_ai_files returns a structured manifest', () => {
    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({
      bookTitle: 'Test Book',
      storyFolder: 'Story',
      languages: [{ code: 'EN', folderName: 'EN' }],
    }, null, 2) + '\n');

    const raw = toolSetupAiFiles(root, { targets: ['claude'], skills: ['review'], overwrite: true });
    const parsed = JSON.parse(raw) as {
      regenerated_files?: string[];
      skipped_files?: string[];
      skill_zips?: { created?: string[]; rebuilt?: string[]; skipped?: string[]; failed?: string[]; reupload_required?: string[] };
      ai_versions?: { versions?: Record<string, { version: number; label: string; zip: string | null }> };
    };

    expect(Array.isArray(parsed.regenerated_files)).toBe(true);
    expect(Array.isArray(parsed.skipped_files)).toBe(true);
    expect(Array.isArray(parsed.skill_zips?.created)).toBe(true);
    expect(Array.isArray(parsed.skill_zips?.rebuilt)).toBe(true);
    expect(Array.isArray(parsed.skill_zips?.skipped)).toBe(true);
    expect(Array.isArray(parsed.skill_zips?.failed)).toBe(true);
    expect(Array.isArray(parsed.skill_zips?.reupload_required)).toBe(true);
    expect(parsed.ai_versions?.versions?.['.claude/skills/review/SKILL.md']?.label).toBe('review skill');
  });

  it('builds skill zips with normalized forward-slash entry paths', () => {
    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({
      bookTitle: 'Test Book',
      storyFolder: 'Story',
      languages: [{ code: 'EN', folderName: 'EN' }],
    }, null, 2) + '\n');

    toolSetupAiFiles(root, { targets: ['claude'], skills: ['read-aloud'], overwrite: true });

    const zipPath = path.join(root, '.claude', 'skills', 'read-aloud.zip');
    expect(fs.existsSync(zipPath)).toBe(true);

    const zipText = fs.readFileSync(zipPath).toString('latin1');
    expect(zipText).toContain('read-aloud/SKILL.md');
    expect(zipText).not.toContain(String.raw`read-aloud\SKILL.md`);
  });

  it('health skips claude files when aiTargets excludes claude', () => {
    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({
      bookTitle: 'Test Book',
      storyFolder: 'Story',
      languages: [{ code: 'EN', folderName: 'EN' }],
    }, null, 2) + '\n');

    toolSetupAiFiles(root, { targets: ['claude'], skills: ['review'], overwrite: true });

    // After setup, restrict aiTargets to exclude claude
    const settingsPath = path.join(root, '.bindery', 'settings.json');
    const settingsAfterSetup = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
    settingsAfterSetup['aiTargets'] = ['copilot'];
    fs.writeFileSync(settingsPath, JSON.stringify(settingsAfterSetup, null, 2) + '\n', 'utf-8');

    // Downgrade the review skill version to simulate outdated
    const versionPath = path.join(root, '.bindery', 'ai-version.json');
    const versionFile = JSON.parse(fs.readFileSync(versionPath, 'utf-8')) as {
      versions: Record<string, { version: number; label: string; zip: string | null }>;
    };
    versionFile.versions['.claude/skills/review/SKILL.md'].version = 0;
    fs.writeFileSync(versionPath, JSON.stringify(versionFile, null, 2) + '\n', 'utf-8');

    const healthRaw = toolHealth(root);
    const health = JSON.parse(healthRaw) as {
      ai_version_outdated?: boolean;
      ai_versions_outdated?: Array<{ file: string }>;
      default_search_mode?: string;
      semantic_index?: string;
    };

    // claude target is not in aiTargets, so its files should not be reported
    expect(health.ai_versions_outdated?.some(x => x.file === '.claude/skills/review/SKILL.md')).toBeFalsy();
    // non-Claude health info (settings presence) is still reported
    expect(JSON.parse(healthRaw)).toHaveProperty('settings', 'present');
    expect(health).toHaveProperty('default_search_mode', 'lexical');
    expect(health).toHaveProperty('semantic_index');
  });

  it('health includes claude files when aiTargets includes claude', () => {
    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({
      bookTitle: 'Test Book',
      storyFolder: 'Story',
      languages: [{ code: 'EN', folderName: 'EN' }],
      aiTargets: ['claude'],
    }, null, 2) + '\n');

    toolSetupAiFiles(root, { targets: ['claude'], skills: ['review'], overwrite: true });

    // Downgrade the review skill version to simulate outdated
    const versionPath = path.join(root, '.bindery', 'ai-version.json');
    const versionFile = JSON.parse(fs.readFileSync(versionPath, 'utf-8')) as {
      versions: Record<string, { version: number; label: string; zip: string | null }>;
    };
    versionFile.versions['.claude/skills/review/SKILL.md'].version = 0;
    fs.writeFileSync(versionPath, JSON.stringify(versionFile, null, 2) + '\n', 'utf-8');

    const healthRaw = toolHealth(root);
    const health = JSON.parse(healthRaw) as {
      ai_version_outdated?: boolean;
      ai_versions_outdated?: Array<{ file: string }>;
    };

    expect(health.ai_version_outdated).toBe(true);
    expect(health.ai_versions_outdated?.some(x => x.file === '.claude/skills/review/SKILL.md')).toBe(true);
  });

  it('setup_ai_files persists aiTargets and aiSkills to settings.json', () => {
    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({
      bookTitle: 'Test Book',
      storyFolder: 'Story',
      languages: [{ code: 'EN', folderName: 'EN' }],
    }, null, 2) + '\n');

    toolSetupAiFiles(root, { targets: ['claude', 'copilot'], skills: ['review'], overwrite: true });

    const settings = JSON.parse(fs.readFileSync(path.join(root, '.bindery', 'settings.json'), 'utf-8')) as {
      aiTargets?: string[];
      aiSkills?: string[];
    };

    expect(settings.aiTargets).toEqual(['claude', 'copilot']);
    expect(settings.aiSkills).toEqual(['review']);
    // pre-existing settings are preserved
    expect((settings as Record<string, unknown>)['bookTitle']).toBe('Test Book');
  });

  it('setup_ai_files accepts translation-review as a valid saved skill', () => {
    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({
      bookTitle: 'Test Book',
      storyFolder: 'Story',
      languages: [{ code: 'EN', folderName: 'EN' }, { code: 'NL', folderName: 'NL' }],
    }, null, 2) + '\n');

    toolSetupAiFiles(root, { targets: ['claude'], skills: ['translation-review'], overwrite: true });

    const settings = JSON.parse(fs.readFileSync(path.join(root, '.bindery', 'settings.json'), 'utf-8')) as {
      aiTargets?: string[];
      aiSkills?: string[];
    };

    expect(settings.aiTargets).toEqual(['claude']);
    expect(settings.aiSkills).toEqual(['translation-review']);
    expect(fs.existsSync(path.join(root, '.claude', 'skills', 'translation-review', 'SKILL.md'))).toBe(true);
  });

  it('setup_ai_files does not set aiSkills when claude is not a target', () => {
    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({
      bookTitle: 'Test Book',
      storyFolder: 'Story',
      languages: [{ code: 'EN', folderName: 'EN' }],
    }, null, 2) + '\n');

    toolSetupAiFiles(root, { targets: ['copilot'], skills: [], overwrite: true });

    const settings = JSON.parse(fs.readFileSync(path.join(root, '.bindery', 'settings.json'), 'utf-8')) as {
      aiTargets?: string[];
      aiSkills?: string[];
    };

    expect(settings.aiTargets).toEqual(['copilot']);
    expect(settings.aiSkills).toBeUndefined();
  });

  it('health reports per-file AI version mismatches', () => {
    const root = makeRoot();
    write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({
      bookTitle: 'Test Book',
      storyFolder: 'Story',
      languages: [{ code: 'EN', folderName: 'EN' }],
    }, null, 2) + '\n');

    toolSetupAiFiles(root, { targets: ['claude'], skills: ['review'], overwrite: true });

    const versionPath = path.join(root, '.bindery', 'ai-version.json');
    const versionFile = JSON.parse(fs.readFileSync(versionPath, 'utf-8')) as {
      versions: Record<string, { version: number; label: string; zip: string | null }>;
    };
    versionFile.versions['.claude/skills/review/SKILL.md'].version = 0;
    fs.writeFileSync(versionPath, JSON.stringify(versionFile, null, 2) + '\n', 'utf-8');

    const healthRaw = toolHealth(root);
    const health = JSON.parse(healthRaw) as {
      ai_version_outdated?: boolean;
      ai_versions_outdated?: Array<{ file: string; label: string; zip: string | null }>;
    };

    expect(health.ai_version_outdated).toBe(true);
    expect(health.ai_versions_outdated?.some(x => x.file === '.claude/skills/review/SKILL.md')).toBe(true);
    expect(health.ai_versions_outdated?.some(x => x.label === 'review skill')).toBe(true);
  });
});
