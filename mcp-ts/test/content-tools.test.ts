import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    toolGetOverview,
    toolGetNotes,
    toolFormat,
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

    it('includes Details_*.md files at root', () => {
        const root = makeRoot();
        write(path.join(root, 'Details_Setting.md'), '# Setting\nA fantasy world.\n');

        const result = toolGetNotes(root, {});
        expect(result).toContain('Details_Setting.md');
        expect(result).toContain('A fantasy world.');
    });

    it('returns no-files message when Notes directory is missing and no Details_* files', () => {
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
});
