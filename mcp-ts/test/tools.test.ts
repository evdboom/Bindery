import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  toolGetChapter,
  toolGetText,
  toolIndexBuild,
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

  it('builds index and returns search results', async () => {
    const root = makeRoot();
    write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Arrival\nThe red comet crossed the sky.\n');

    const build = toolIndexBuild(root);
    expect(build).toContain('Index built:');

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
