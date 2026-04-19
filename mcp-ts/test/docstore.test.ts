/**
 * Tests for docstore.ts — file discovery, chunking, and helper functions.
 *
 * Focuses on edge cases in chapter range filtering, act name filtering,
 * language selection, and chunk splitting.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { chunkFile, chunkWorkspace, discoverFiles } from '../src/docstore';

const tempRoots: string[] = [];

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-docstore-test-'));
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

// ─── discoverFiles — basics ─────────────────────────────────────────────────

describe('discoverFiles', () => {
    it('returns empty array when Story folder does not exist', () => {
        const root = makeRoot();
        expect(discoverFiles(root)).toEqual([]);
    });

    it('discovers files in language sub-folders', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n');
        write(path.join(root, 'Story', 'NL', 'Act I', 'Hoofdstuk1.md'), '# H1\n');

        const files = discoverFiles(root);
        expect(files).toHaveLength(2);
    });

    it('discovers top-level .md files in Story root', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'AGENTS.md'), '# Agents\n');

        const files = discoverFiles(root);
        expect(files).toHaveLength(1);
        expect(files[0]).toContain('AGENTS.md');
    });

    it('includes Notes directory', () => {
        const root = makeRoot();
        write(path.join(root, 'Notes', 'Characters.md'), '# Chars\n');

        const files = discoverFiles(root);
        expect(files.some(f => f.includes('Characters.md'))).toBe(true);
    });

    it('includes Arc directory only when includeArc is true', () => {
        const root = makeRoot();
        write(path.join(root, 'Arc', 'timeline.md'), '# Timeline\n');

        const withoutArc = discoverFiles(root, { includeArc: false });
        expect(withoutArc.some(f => f.includes('timeline.md'))).toBe(false);

        const withArc = discoverFiles(root, { includeArc: true });
        expect(withArc.some(f => f.includes('timeline.md'))).toBe(true);
    });
});

// ─── discoverFiles — language filter ─────────────────────────────────────────

describe('discoverFiles — language filter', () => {
    it('filters to a single language', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n');
        write(path.join(root, 'Story', 'NL', 'Act I', 'Hoofdstuk1.md'), '# H1\n');

        const files = discoverFiles(root, { language: 'EN' });
        expect(files.every(f => f.includes(path.sep + 'EN' + path.sep))).toBe(true);
    });

    it('case-insensitive language matching', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n');

        const files = discoverFiles(root, { language: 'en' });
        expect(files).toHaveLength(1);
    });

    it('"ALL" language returns everything', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n');
        write(path.join(root, 'Story', 'NL', 'Act I', 'Hoofdstuk1.md'), '# H1\n');

        const files = discoverFiles(root, { language: 'ALL' });
        expect(files).toHaveLength(2);
    });
});

// ─── discoverFiles — chapter range filter ────────────────────────────────────

describe('discoverFiles — chapter range', () => {
    it('filters by single chapter number (e.g. "3")', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n');
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter2.md'), '# Ch2\n');
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter3.md'), '# Ch3\n');

        const files = discoverFiles(root, { chapterRange: '3' });
        expect(files).toHaveLength(1);
        expect(files[0]).toContain('Chapter3.md');
    });

    it('filters by range (e.g. "2-3")', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n');
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter2.md'), '# Ch2\n');
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter3.md'), '# Ch3\n');
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter4.md'), '# Ch4\n');

        const files = discoverFiles(root, { chapterRange: '2-3' });
        expect(files).toHaveLength(2);
        expect(files.some(f => f.includes('Chapter2.md'))).toBe(true);
        expect(files.some(f => f.includes('Chapter3.md'))).toBe(true);
    });

    it('includes top-level .md files in language folder regardless of range filter', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Prologue.md'), '# Prologue\n');
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n');
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter5.md'), '# Ch5\n');

        const files = discoverFiles(root, { chapterRange: '5' });
        // Prologue is top-level in lang dir, should be included (no number → passes filter)
        // Chapter1 excluded (num 1 < 5), Chapter5 included
        expect(files.some(f => f.includes('Prologue.md'))).toBe(true);
        expect(files.some(f => f.includes('Chapter5.md'))).toBe(true);
        expect(files.some(f => f.includes('Chapter1.md'))).toBe(false);
    });

    it('treats non-numeric range gracefully', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n');

        // 'abc' parses to NaN → null, so no filter is applied
        const files = discoverFiles(root, { chapterRange: 'abc' });
        expect(files).toHaveLength(1);
    });
});

// ─── discoverFiles — act name filter ─────────────────────────────────────────

describe('discoverFiles — act name filter', () => {
    it('filters act directories by substring match', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n');
        write(path.join(root, 'Story', 'EN', 'Act II', 'Chapter2.md'), '# Ch2\n');

        const files = discoverFiles(root, { actName: 'Act II' });
        expect(files).toHaveLength(1);
        expect(files[0]).toContain('Chapter2.md');
    });

    it('act filter is case-insensitive', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n');

        const files = discoverFiles(root, { actName: 'act i' });
        expect(files).toHaveLength(1);
    });
});

// ─── chunkFile ──────────────────────────────────────────────────────────────

describe('chunkFile', () => {
    it('creates one chunk for a single paragraph', () => {
        const root = makeRoot();
        const filePath = path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md');
        write(filePath, '# Chapter 1\nSome text here.\n');

        const chunks = chunkFile(filePath, root);
        expect(chunks).toHaveLength(1);
        expect(chunks[0].text).toContain('Chapter 1');
        // Language detection relies on /Story/ pattern with preceding path separator;
        // when relPath starts directly with 'Story/' it may not match.
    });

    it('splits on blank lines into multiple chunks', () => {
        const root = makeRoot();
        const filePath = path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md');
        write(filePath, '# Chapter 1\n\nParagraph one.\n\nParagraph two.\n');

        const chunks = chunkFile(filePath, root);
        expect(chunks).toHaveLength(3); // heading, para1, para2
        expect(chunks[0].text).toContain('Chapter 1');
        expect(chunks[1].text).toContain('Paragraph one');
        expect(chunks[2].text).toContain('Paragraph two');
    });

    it('chunks have unique IDs', () => {
        const root = makeRoot();
        const filePath = path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md');
        write(filePath, '# A\n\nB\n\nC\n');

        const chunks = chunkFile(filePath, root);
        const ids = chunks.map(c => c.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('chunks have correct relPath with forward slashes', () => {
        const root = makeRoot();
        const filePath = path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md');
        write(filePath, '# Ch1\n');

        const chunks = chunkFile(filePath, root);
        expect(chunks[0].relPath).toContain('/');
        expect(chunks[0].relPath).not.toContain('\\');
    });

    it('file outside Story has no language', () => {
        const root = makeRoot();
        const filePath = path.join(root, 'Notes', 'Characters.md');
        write(filePath, '# Characters\nAlice\n');

        const chunks = chunkFile(filePath, root);
        expect(chunks[0].language).toBeUndefined();
    });

    it('empty file produces no chunks', () => {
        const root = makeRoot();
        const filePath = path.join(root, 'Story', 'EN', 'Act I', 'empty.md');
        write(filePath, '');

        const chunks = chunkFile(filePath, root);
        expect(chunks).toHaveLength(0);
    });

    it('file with only blank lines produces no chunks', () => {
        const root = makeRoot();
        const filePath = path.join(root, 'Story', 'EN', 'Act I', 'blank.md');
        write(filePath, '\n\n\n\n');

        const chunks = chunkFile(filePath, root);
        expect(chunks).toHaveLength(0);
    });

    it('chunks have 1-based line numbers', () => {
        const root = makeRoot();
        const filePath = path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md');
        write(filePath, '# Heading\n\nLine three\nLine four\n');

        const chunks = chunkFile(filePath, root);
        expect(chunks[0].startLine).toBe(1); // heading
        expect(chunks[1].startLine).toBe(3); // paragraph starting at line 3
    });
});

// ─── chunkWorkspace ──────────────────────────────────────────────────────────

describe('chunkWorkspace', () => {
    it('returns chunks across multiple files', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\nAlpha\n');
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter2.md'), '# Ch2\nBeta\n');

        const chunks = chunkWorkspace(root);
        expect(chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('passes options through to discoverFiles', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n');
        write(path.join(root, 'Story', 'NL', 'Act I', 'Hoofdstuk1.md'), '# H1\n');

        const enChunks = chunkWorkspace(root, { language: 'EN' });
        // Language filter controls which files are discovered, not chunk language.
        // Files discovered from EN folder are included; NL files are excluded.
        expect(enChunks.length).toBeGreaterThan(0);
        // All discovered files should be from the EN folder
        expect(enChunks.every(c => c.relPath.includes('/EN/'))).toBe(true);
    });

    it('skips unreadable files without crashing', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n');
        // Create a directory where a file is expected — reading it will throw
        fs.mkdirSync(path.join(root, 'Story', 'EN', 'Act I', 'Broken.md'), { recursive: true });

        // Should not throw
        const chunks = chunkWorkspace(root);
        expect(chunks.length).toBeGreaterThanOrEqual(1);
    });
});
