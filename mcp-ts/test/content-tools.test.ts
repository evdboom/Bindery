import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    toolGetOverview,
    toolGetNotes,
    toolFormat,
    countWords,
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

// ─── toolGetOverview ──────────────────────────────────────────────────────────

describe('toolGetOverview', () => {
    it('lists acts and chapters for all languages when no filter', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# The Start\nContent.\n');
        write(path.join(root, 'Story', 'NL', 'Act I', 'Hoofdstuk 1.md'), '# Begin\nInhoud.\n');

        const result = toolGetOverview(root, {});
        expect(result).toContain('EN');
        expect(result).toContain('NL');
        expect(result).toContain('Act I');
        expect(result).toContain('Chapter 1.md');
        expect(result).toContain('Hoofdstuk 1.md');
    });

    it('filters to a single language when language is specified', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Start\n');
        write(path.join(root, 'Story', 'NL', 'Act I', 'Hoofdstuk 1.md'), '# Begin\n');

        const result = toolGetOverview(root, { language: 'EN' });
        expect(result).toContain('EN');
        expect(result).not.toContain('NL');
    });

    it('filters to a specific act number', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Act I Chapter\n');
        write(path.join(root, 'Story', 'EN', 'Act II', 'Chapter 2.md'), '# Act II Chapter\n');

        const result = toolGetOverview(root, { act: 1 });
        expect(result).toContain('Act I');
        expect(result).not.toContain('Act II');
    });

    it('includes top-level prologue/epilogue files when no act filter', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Ch\n');
        write(path.join(root, 'Story', 'EN', 'Prologue.md'), '# Prologue\n');

        const result = toolGetOverview(root, {});
        expect(result).toContain('Top-level');
        expect(result).toContain('Prologue.md');
    });

    it('does NOT include top-level files when act filter is applied', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Ch\n');
        write(path.join(root, 'Story', 'EN', 'Prologue.md'), '# Prologue\n');

        const result = toolGetOverview(root, { act: 1 });
        expect(result).not.toContain('Top-level');
        expect(result).not.toContain('Prologue.md');
    });

    it('returns a no-folders message when story directory is empty', () => {
        const root = makeRoot();
        const result = toolGetOverview(root, {});
        expect(result).toBe('No language folders found.');
    });

    it('includes the first H1 heading in chapter listings', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# The Dark Forest\nSome text.\n');

        const result = toolGetOverview(root, {});
        expect(result).toContain('The Dark Forest');
    });

    it('does not include word counts when the option is absent or false', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Ch\nOne two.\n');
        expect(toolGetOverview(root, {})).not.toContain('words');
        expect(toolGetOverview(root, { includeWordCounts: false })).not.toContain('words');
    });

    it('appends per-file, act, top-level, and language word counts when enabled', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Ch1\nOne two three.\n');
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 2.md'), '# Ch2\nFour five.\n');
        write(path.join(root, 'Story', 'EN', 'Prologue.md'), '# Prologue\nSix seven eight.\n');

        const result = toolGetOverview(root, { includeWordCounts: true });
        expect(result).toContain('Chapter 1.md: Ch1 (4 words)');
        expect(result).toContain('Chapter 2.md: Ch2 (3 words)');
        expect(result).toContain('Prologue.md: Prologue (4 words)');
        expect(result).toContain('_Subtotal: 7 words_');
        expect(result).toContain('_Subtotal: 4 words_');
        expect(result).toContain('_Total: 11 words_');
    });

    it('counts non-ASCII (Unicode) prose correctly', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Café\nhéllo wörld naïve.\n');

        const result = toolGetOverview(root, { includeWordCounts: true });
        expect(result).toContain('Chapter 1.md: Café (4 words)');
    });

    it('reports totals only for content visible under an act filter', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# A\nOne two.\n');
        write(path.join(root, 'Story', 'EN', 'Act II', 'Chapter 2.md'), '# B\nThree four five.\n');
        write(path.join(root, 'Story', 'EN', 'Prologue.md'), '# P\nSix seven eight nine.\n');

        const result = toolGetOverview(root, { act: 1, includeWordCounts: true });
        expect(result).toContain('Chapter 1.md: A (3 words)');
        expect(result).toContain('_Subtotal: 3 words_');
        expect(result).toContain('_Total: 3 words_');
        expect(result).not.toContain('Act II');
        expect(result).not.toContain('Prologue.md');
    });

    it('reports zero words for empty files without throwing', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '');

        const result = toolGetOverview(root, { includeWordCounts: true });
        expect(result).toContain('Chapter 1.md (0 words)');
        expect(result).toContain('_Subtotal: 0 words_');
        expect(result).toContain('_Total: 0 words_');
    });
});

describe('countWords', () => {
    it('counts ASCII words and ignores pure punctuation tokens', () => {
        expect(countWords('Hello world')).toBe(2);
        expect(countWords('# Heading here')).toBe(2);
        expect(countWords('**bold** text')).toBe(2);
        expect(countWords('---')).toBe(0);
        expect(countWords('')).toBe(0);
        expect(countWords('123')).toBe(1);
    });

    it('counts non-ASCII (Unicode) words', () => {
        expect(countWords('héllo wörld')).toBe(2);
        expect(countWords('café naïve résumé')).toBe(3);
    });
});

// ─── toolGetNotes ─────────────────────────────────────────────────────────────

describe('toolGetNotes', () => {
    it('returns all notes from the Notes directory', () => {
        const root = makeRoot();
        write(path.join(root, 'Notes', 'Characters.md'), '# Characters\nHero: Alice.\n');
        write(path.join(root, 'Notes', 'Worldbuilding.md'), '# World\nMagic system.\n');

        const result = toolGetNotes(root, {});
        expect(result).toContain('Characters.md');
        expect(result).toContain('Worldbuilding.md');
    });

    it('filters by category (file name match)', () => {
        const root = makeRoot();
        write(path.join(root, 'Notes', 'Characters.md'), '# Characters\nAlice.\n');
        write(path.join(root, 'Notes', 'Worldbuilding.md'), '# World\nMagic.\n');

        const result = toolGetNotes(root, { category: 'character' });
        expect(result).toContain('Characters.md');
        expect(result).not.toContain('Worldbuilding.md');
    });

    it('filters by name within file content', () => {
        const root = makeRoot();
        write(path.join(root, 'Notes', 'Characters.md'), '# Characters\n\n## Alice\nThe hero.\n\n## Bob\nThe sidekick.\n');

        const result = toolGetNotes(root, { name: 'alice' });
        expect(result).toContain('Alice');
        expect(result).not.toContain('Bob');
    });

    it('returns no-files message when Notes directory is missing', () => {
        const root = makeRoot();
        const result = toolGetNotes(root, {});
        expect(result).toContain('No notes files found.');
    });

    it('returns no-match message when name filter has no results', () => {
        const root = makeRoot();
        write(path.join(root, 'Notes', 'Characters.md'), '# Characters\n\n## Alice\nThe hero.\n');

        const result = toolGetNotes(root, { name: 'charlie' });
        expect(result).toContain('No matching notes found.');
    });
});

// ─── toolFormat ───────────────────────────────────────────────────────────────

describe('toolFormat', () => {
    it('formats a single file with typography transforms', () => {
        const root = makeRoot();
        const filePath = path.join(root, 'Story', 'EN', 'Chapter 1.md');
        write(filePath, '# Chapter\nHe said "Hello..." and she replied.\n');

        const result = toolFormat(root, { filePath: path.join('Story', 'EN', 'Chapter 1.md') });
        expect(result).toContain('Formatted 1 file');

        const updated = fs.readFileSync(filePath, 'utf-8');
        // Ellipsis should be converted
        expect(updated).toContain('\u2026');
        // Curly quotes should be applied
        expect(updated).toContain('\u201C');
    });

    it('dry-run reports files that need formatting but does not write', () => {
        const root = makeRoot();
        const filePath = path.join(root, 'Story', 'EN', 'Chapter 1.md');
        const original = '# Chapter\nHe said "Hello..."\n';
        write(filePath, original);

        const result = toolFormat(root, { filePath: path.join('Story', 'EN', 'Chapter 1.md'), dryRun: true });
        expect(result).toContain('Would format 1 file');
        expect(fs.readFileSync(filePath, 'utf-8')).toBe(original);
    });

    it('reports no files needed when content is already clean', () => {
        const root = makeRoot();
        const filePath = path.join(root, 'Story', 'EN', 'Chapter 1.md');
        // Already formatted: uses curly quotes and ellipsis character
        write(filePath, '# Chapter\nHe said \u201CHello\u2026\u201D\n');

        const result = toolFormat(root, { filePath: path.join('Story', 'EN', 'Chapter 1.md') });
        expect(result).toContain('No files needed formatting.');
    });

    it('recurses into subdirectories by default', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'ch1.md'), '# One\n"Hello..."\n');
        write(path.join(root, 'Story', 'EN', 'Act II', 'ch2.md'), '# Two\n"World..."\n');

        const result = toolFormat(root, { filePath: path.join('Story', 'EN') });
        expect(result).toContain('Formatted 2 file');
    });

    it('noRecurse skips subdirectories', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'top.md'), '# Top\n"Hello..."\n');
        write(path.join(root, 'Story', 'EN', 'sub', 'nested.md'), '# Sub\n"World..."\n');

        const result = toolFormat(root, { filePath: path.join('Story', 'EN'), noRecurse: true });
        expect(result).toContain('Formatted 1 file');

        // Nested file should be unchanged
        const nestedContent = fs.readFileSync(path.join(root, 'Story', 'EN', 'sub', 'nested.md'), 'utf-8');
        expect(nestedContent).toContain('"World..."');
    });

    it('returns path-not-found for a non-existent path', () => {
        const root = makeRoot();
        const result = toolFormat(root, { filePath: 'does/not/exist.md' });
        expect(result).toContain('Path not found');
    });

    it('prepends root when filePath is relative', () => {
        const root = makeRoot();
        const relPath = path.join('Story', 'EN', 'ch.md');
        write(path.join(root, relPath), '# Ch\n"Hello..."\n');

        const result = toolFormat(root, { filePath: relPath });
        expect(result).toContain('Formatted 1 file');
    });

    it('rejects absolute paths outside the workspace', () => {
        const root = makeRoot();
        const outside = path.join(path.dirname(root), 'outside.md');
        write(outside, '# Outside\n"Hello..."\n');

        const result = toolFormat(root, { filePath: outside });
        expect(result).toContain('Invalid path');
    });
});
