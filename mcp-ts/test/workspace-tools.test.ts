import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    toolInitWorkspace,
    toolAddLanguage,
    toolSetupAiFiles,
    toolMemoryAppend,
    toolMemoryCompact,
    toolChapterStatusUpdate,
    toolChapterStatusGet,
    toolMemoryList,
} from '../src/tools';

const tempRoots: string[] = [];

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-mcp-XXX-test-'));
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

// ─── toolInitWorkspace ────────────────────────────────────────────────────────

describe('toolInitWorkspace', () => {
    it('creates settings.json and translations.json for a new workspace', () => {
        const root = makeRoot();
        const result = toolInitWorkspace(root, { bookTitle: 'My Novel' });

        expect(result).toContain('Initialised');
        expect(result).toContain('.bindery/settings.json');
        expect(result).toContain('.bindery/translations.json');

        const settings = JSON.parse(
            fs.readFileSync(path.join(root, '.bindery', 'settings.json'), 'utf-8')
        ) as Record<string, unknown>;
        expect(settings['bookTitle']).toBe('My Novel');
        expect(settings['storyFolder']).toBe('Story');
        expect(fs.existsSync(path.join(root, '.bindery', 'translations.json'))).toBe(true);
    });

    it('includes a Tip: hint for new workspaces', () => {
        const root = makeRoot();
        const result = toolInitWorkspace(root, {});
        expect(result).toContain('Tip:');
    });

    it('does NOT include Tip: hint for existing workspaces', () => {
        const root = makeRoot();
        write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({ bookTitle: 'Old' }) + '\n');
        const result = toolInitWorkspace(root, { bookTitle: 'Updated' });
        expect(result).not.toContain('Tip:');
        expect(result).toContain('Updated');
    });

    it('preserves existing keys when updating', () => {
        const root = makeRoot();
        const original = { bookTitle: 'Old', customKey: 'preserve-me', storyFolder: 'Story', languages: [] };
        write(path.join(root, '.bindery', 'settings.json'), JSON.stringify(original) + '\n');

        toolInitWorkspace(root, { bookTitle: 'New Title' });

        const settings = JSON.parse(
            fs.readFileSync(path.join(root, '.bindery', 'settings.json'), 'utf-8')
        ) as Record<string, unknown>;
        expect(settings['customKey']).toBe('preserve-me');
        expect(settings['bookTitle']).toBe('New Title');
    });

    it('detects language folders from story directory', () => {
        const root = makeRoot();
        fs.mkdirSync(path.join(root, 'Story', 'EN'), { recursive: true });
        fs.mkdirSync(path.join(root, 'Story', 'NL'), { recursive: true });

        const result = toolInitWorkspace(root, {});
        expect(result).toContain('EN');
        expect(result).toContain('NL');

        const settings = JSON.parse(
            fs.readFileSync(path.join(root, '.bindery', 'settings.json'), 'utf-8')
        ) as { languages: Array<{ code: string }> };
        const codes = settings.languages.map(l => l.code);
        expect(codes).toContain('EN');
        expect(codes).toContain('NL');
    });

    it('does NOT overwrite existing translations.json', () => {
        const root = makeRoot();
        const existingTranslations = { 'custom-lang': { type: 'glossary', rules: [{ from: 'x', to: 'y' }] } };
        write(path.join(root, '.bindery', 'translations.json'), JSON.stringify(existingTranslations) + '\n');
        write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({ bookTitle: 'B' }) + '\n');

        toolInitWorkspace(root, {});

        const trans = JSON.parse(
            fs.readFileSync(path.join(root, '.bindery', 'translations.json'), 'utf-8')
        ) as Record<string, unknown>;
        expect(trans['custom-lang']).toBeDefined();
    });

    it('seeds en-gb rules when a language declares it as a dialect', () => {
        const root = makeRoot();
        const settingsWithDialect = {
            bookTitle: 'B',
            storyFolder: 'Story',
            languages: [{ code: 'EN', folderName: 'EN', dialects: [{ code: 'en-gb' }] }],
        };
        write(path.join(root, '.bindery', 'settings.json'), JSON.stringify(settingsWithDialect) + '\n');

        const result = toolInitWorkspace(root, {});
        expect(result).toContain('en-gb dialect seeded');

        const trans = JSON.parse(
            fs.readFileSync(path.join(root, '.bindery', 'translations.json'), 'utf-8')
        ) as { 'en-gb': { rules: unknown[] } };
        expect(trans['en-gb'].rules.length).toBeGreaterThan(0);
    });

    it('returns "Updated" for an existing workspace', () => {
        const root = makeRoot();
        write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({ bookTitle: 'X' }) + '\n');
        const result = toolInitWorkspace(root, {});
        expect(result).toContain('Updated');
    });
});

// ─── toolAddLanguage ──────────────────────────────────────────────────────────

describe('toolAddLanguage', () => {
    it('adds language to settings', () => {
        const root = makeRoot();
        write(path.join(root, '.bindery', 'settings.json'), JSON.stringify({ bookTitle: 'B', storyFolder: 'Story', languages: [] }) + '\n');

        const result = toolAddLanguage(root, { code: 'fr' });
        expect(result).toContain('FR');

        const settings = JSON.parse(
            fs.readFileSync(path.join(root, '.bindery', 'settings.json'), 'utf-8')
        ) as { languages: Array<{ code: string }> };
        expect(settings.languages.some(l => l.code === 'FR')).toBe(true);
    });

    it('updates without duplicating when language already exists', () => {
        const root = makeRoot();
        write(
            path.join(root, '.bindery', 'settings.json'),
            JSON.stringify({ bookTitle: 'B', storyFolder: 'Story', languages: [{ code: 'FR', folderName: 'FR', chapterWord: 'Chapitre', actPrefix: 'Acte', prologueLabel: 'Prologue', epilogueLabel: 'Epilogue' }] }) + '\n'
        );

        toolAddLanguage(root, { code: 'fr', chapterWord: 'Chapître' });

        const settings = JSON.parse(
            fs.readFileSync(path.join(root, '.bindery', 'settings.json'), 'utf-8')
        ) as { languages: Array<{ code: string; chapterWord: string }> };
        const frLangs = settings.languages.filter(l => l.code === 'FR');
        expect(frLangs).toHaveLength(1);
        expect(frLangs[0].chapterWord).toBe('Chapître');
    });

    it('creates stub files mirroring source language', () => {
        const root = makeRoot();
        write(
            path.join(root, '.bindery', 'settings.json'),
            JSON.stringify({
                bookTitle: 'B',
                storyFolder: 'Story',
                languages: [{ code: 'EN', folderName: 'EN', chapterWord: 'Chapter', actPrefix: 'Act', prologueLabel: 'Prologue', epilogueLabel: 'Epilogue', isDefault: true }],
            }) + '\n'
        );
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# First Chapter\nContent here.\n');

        const result = toolAddLanguage(root, { code: 'NL' });
        expect(result).toContain('NL');

        const stubPath = path.join(root, 'Story', 'NL', 'Act I', 'Chapter 1.md');
        expect(fs.existsSync(stubPath)).toBe(true);
        expect(fs.readFileSync(stubPath, 'utf-8')).toContain('[Untranslated]');
    });

    it('does not overwrite existing stub files', () => {
        const root = makeRoot();
        write(
            path.join(root, '.bindery', 'settings.json'),
            JSON.stringify({
                bookTitle: 'B',
                storyFolder: 'Story',
                languages: [{ code: 'EN', folderName: 'EN', chapterWord: 'Chapter', actPrefix: 'Act', prologueLabel: 'Prologue', epilogueLabel: 'Epilogue', isDefault: true }],
            }) + '\n'
        );
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# First\nContent.\n');

        const existing = '# Already translated\nFrench content.\n';
        write(path.join(root, 'Story', 'FR', 'Act I', 'Chapter 1.md'), existing);

        toolAddLanguage(root, { code: 'FR' });

        const content = fs.readFileSync(path.join(root, 'Story', 'FR', 'Act I', 'Chapter 1.md'), 'utf-8');
        expect(content).toBe(existing);
    });

    it('returns error when settings.json is missing', () => {
        const root = makeRoot();
        const result = toolAddLanguage(root, { code: 'DE' });
        expect(result).toContain('Error');
        expect(result).toContain('settings.json');
    });
});

// ─── toolSetupAiFiles ─────────────────────────────────────────────────────────

describe('toolSetupAiFiles', () => {
    function makeSettingsRoot(): string {
        const root = makeRoot();
        write(
            path.join(root, '.bindery', 'settings.json'),
            JSON.stringify({ bookTitle: 'Test Book', storyFolder: 'Story', languages: [{ code: 'EN', folderName: 'EN' }] }) + '\n'
        );
        return root;
    }

    it('creates CLAUDE.md when claude target requested', () => {
        const root = makeSettingsRoot();
        toolSetupAiFiles(root, { targets: ['claude'], skills: [], overwrite: true });
        expect(fs.existsSync(path.join(root, 'CLAUDE.md'))).toBe(true);
    });

    it('skips generating existing files when overwrite is false', () => {
        const root = makeSettingsRoot();
        toolSetupAiFiles(root, { targets: ['claude'], skills: [], overwrite: true });
        const first = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8');

        toolSetupAiFiles(root, { targets: ['claude'], skills: [], overwrite: false });
        const second = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8');
        expect(first).toBe(second);

        const raw = toolSetupAiFiles(root, { targets: ['claude'], skills: [], overwrite: false });
        const parsed = JSON.parse(raw) as { skipped_files: string[] };
        expect(parsed.skipped_files.some(f => f.includes('CLAUDE.md'))).toBe(true);
    });

    it('stamps ai-version.json after running', () => {
        const root = makeSettingsRoot();
        toolSetupAiFiles(root, { targets: ['claude'], skills: ['review'], overwrite: true });
        expect(fs.existsSync(path.join(root, '.bindery', 'ai-version.json'))).toBe(true);
    });

    it('returns error for invalid targets only', () => {
        const root = makeSettingsRoot();
        const result = toolSetupAiFiles(root, { targets: ['not-a-target'] as string[], skills: [] });
        expect(result).toContain('No valid targets');
    });
});

// ─── toolMemoryAppend ─────────────────────────────────────────────────────────

describe('toolMemoryAppend', () => {
    it('creates memories directory and appends a new file', () => {
        const root = makeRoot();
        const result = toolMemoryAppend(root, { file: 'global.md', title: 'Init', content: 'First note.' });

        const memPath = path.join(root, '.bindery', 'memories', 'global.md');
        expect(fs.existsSync(memPath)).toBe(true);
        expect(result).toContain('Appended to global.md');
    });

    it('appends (does not overwrite) on repeated calls', () => {
        const root = makeRoot();
        toolMemoryAppend(root, { file: 'global.md', title: 'First', content: 'Entry one.' });
        toolMemoryAppend(root, { file: 'global.md', title: 'Second', content: 'Entry two.' });

        const content = fs.readFileSync(
            path.join(root, '.bindery', 'memories', 'global.md'), 'utf-8'
        );
        expect(content).toContain('Entry one.');
        expect(content).toContain('Entry two.');
    });

    it('stamps a ## Session header with today\'s date', () => {
        const root = makeRoot();
        toolMemoryAppend(root, { file: 'global.md', title: 'Test Entry', content: 'Some content.' });

        const content = fs.readFileSync(
            path.join(root, '.bindery', 'memories', 'global.md'), 'utf-8'
        );
        const today = new Date().toISOString().slice(0, 10);
        expect(content).toContain(`## Session ${today} — Test Entry`);
    });
});

// ─── toolMemoryCompact ────────────────────────────────────────────────────────

describe('toolMemoryCompact', () => {
    it('creates archive backup of existing file', () => {
        const root = makeRoot();
        toolMemoryAppend(root, { file: 'global.md', title: 'Old', content: 'Long history.' });

        toolMemoryCompact(root, { file: 'global.md', compacted_content: '# Compact\nSummary.' });

        const archiveDir = path.join(root, '.bindery', 'memories', 'archive');
        expect(fs.existsSync(archiveDir)).toBe(true);
        const backups = fs.readdirSync(archiveDir);
        expect(backups.some(f => f.startsWith('global_'))).toBe(true);
    });

    it('replaces file content with compacted version', () => {
        const root = makeRoot();
        toolMemoryAppend(root, { file: 'global.md', title: 'Old', content: 'Long history.' });

        toolMemoryCompact(root, { file: 'global.md', compacted_content: '# Compact\nSummary.' });

        const content = fs.readFileSync(
            path.join(root, '.bindery', 'memories', 'global.md'), 'utf-8'
        );
        expect(content).toBe('# Compact\nSummary.');
    });

    it('handles compact when file does not exist yet', () => {
        const root = makeRoot();
        const result = toolMemoryCompact(root, { file: 'ch01.md', compacted_content: 'Fresh start.' });

        expect(result).toContain('Compacted ch01.md');
        const content = fs.readFileSync(
            path.join(root, '.bindery', 'memories', 'ch01.md'), 'utf-8'
        );
        expect(content).toBe('Fresh start.');
    });

    it('second compaction also produces a backup', () => {
        const root = makeRoot();
        toolMemoryAppend(root, { file: 'global.md', title: 'A', content: 'Content A.' });
        toolMemoryCompact(root, { file: 'global.md', compacted_content: 'Compacted A.' });
        toolMemoryCompact(root, { file: 'global.md', compacted_content: 'Compacted B.' });

        const archiveDir = path.join(root, '.bindery', 'memories', 'archive');
        const backups = fs.readdirSync(archiveDir).filter(f => f.startsWith('global_'));
        // At minimum one backup file exists (same day = same filename, overwritten)
        expect(backups.length).toBeGreaterThanOrEqual(1);
    });
});

// ─── toolMemoryList ───────────────────────────────────────────────────────────

describe('toolMemoryList', () => {
    it('returns message when no memories directory exists', () => {
        const root = makeRoot();
        const result = toolMemoryList(root);
        expect(result).toContain('No memory files found');
    });

    it('lists memory files with line counts', () => {
        const root = makeRoot();
        toolMemoryAppend(root, { file: 'global.md', title: 'T', content: 'Line one.\nLine two.' });
        toolMemoryAppend(root, { file: 'ch01.md', title: 'T', content: 'Chapter note.' });

        const result = toolMemoryList(root);
        expect(result).toContain('ch01.md');
        expect(result).toContain('global.md');
        expect(result).toMatch(/\(\d+ lines\)/);
    });
});

// ─── toolChapterStatusUpdate ──────────────────────────────────────────────────

describe('toolChapterStatusUpdate', () => {
    it('creates chapter-status.json and adds chapters', () => {
        const root = makeRoot();
        const result = toolChapterStatusUpdate(root, {
            chapters: [{ number: 1, title: 'The Beginning', language: 'EN', status: 'done' }],
        });

        expect(result).toContain('1 added');
        expect(fs.existsSync(path.join(root, '.bindery', 'chapter-status.json'))).toBe(true);
    });

    it('upserts without duplicating existing chapters', () => {
        const root = makeRoot();
        toolChapterStatusUpdate(root, {
            chapters: [{ number: 1, title: 'Ch 1', language: 'EN', status: 'draft' }],
        });
        const result = toolChapterStatusUpdate(root, {
            chapters: [{ number: 1, title: 'Ch 1 Updated', language: 'EN', status: 'done' }],
        });

        expect(result).toContain('0 added');
        expect(result).toContain('1 updated');

        const data = JSON.parse(
            fs.readFileSync(path.join(root, '.bindery', 'chapter-status.json'), 'utf-8')
        ) as { chapters: Array<{ number: number; title: string; status: string }> };
        expect(data.chapters.filter(c => c.number === 1)).toHaveLength(1);
        expect(data.chapters[0].status).toBe('done');
    });

    it('normalises language to uppercase', () => {
        const root = makeRoot();
        toolChapterStatusUpdate(root, {
            chapters: [{ number: 1, title: 'Ch 1', language: 'nl', status: 'planned' }],
        });

        const data = JSON.parse(
            fs.readFileSync(path.join(root, '.bindery', 'chapter-status.json'), 'utf-8')
        ) as { chapters: Array<{ language: string }> };
        expect(data.chapters[0].language).toBe('NL');
    });

    it('returns error for empty chapters array', () => {
        const root = makeRoot();
        const result = toolChapterStatusUpdate(root, { chapters: [] });
        expect(result).toContain('Error');
    });
});

// ─── toolChapterStatusGet ─────────────────────────────────────────────────────

describe('toolChapterStatusGet', () => {
    it('returns message when no chapter status file exists', () => {
        const root = makeRoot();
        const result = toolChapterStatusGet(root);
        expect(result).toContain('No chapter status');
    });

    it('groups chapters by status', () => {
        const root = makeRoot();
        toolChapterStatusUpdate(root, {
            chapters: [
                { number: 1, title: 'First',  language: 'EN', status: 'done' },
                { number: 2, title: 'Second', language: 'EN', status: 'draft' },
                { number: 3, title: 'Third',  language: 'EN', status: 'done' },
            ],
        });

        const result = toolChapterStatusGet(root);
        expect(result).toContain('Done');
        expect(result).toContain('Draft');
        // Done group should appear before Draft
        expect(result.indexOf('Done')).toBeLessThan(result.indexOf('Draft'));
    });

    it('includes word count and notes when present', () => {
        const root = makeRoot();
        toolChapterStatusUpdate(root, {
            chapters: [
                { number: 1, title: 'Ch 1', language: 'EN', status: 'in-progress', wordCount: 3500, notes: 'Needs polish' },
            ],
        });

        const result = toolChapterStatusGet(root);
        expect(result).toContain('3500');
        expect(result).toContain('Needs polish');
    });
});
