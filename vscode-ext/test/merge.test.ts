/**
 * Unit tests for merge.ts — pure/filesystem functions only.
 * Does NOT invoke pandoc (only 'md' outputType is exercised here).
 *
 * VS Code is mocked because workspace.ts (imported transitively for its
 * exported types) may resolve vscode at module-load time.
 */

import { vi } from 'vitest';

// ─── Mock vscode (must precede all transitive imports) ────────────────────────
vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: () => ({ get: (_key: string) => undefined }),
        workspaceFolders: undefined,
    },
    window: {
        showErrorMessage:       vi.fn(),
        showInformationMessage: vi.fn(),
        showInputBox:           vi.fn(),
        showQuickPick:          vi.fn(),
    },
    Uri: { file: (p: string) => ({ fsPath: p }) },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    LanguageModelToolResult: class { constructor(public readonly content: unknown[]) {} },
    LanguageModelTextPart:   class { constructor(public readonly value: string) {} },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import * as fs   from 'fs';
import * as os   from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    getBuiltInUkReplacements,
    mergeBook,
    type LanguageConfig,
    type MergeOptions,
} from '../src/merge';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const tempRoots: string[] = [];

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-vscode-merge-test-'));
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

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const EN: LanguageConfig = {
    code:          'EN',
    folderName:    'EN',
    chapterWord:   'Chapter',
    actPrefix:     'Act',
    prologueLabel: 'Prologue',
    epilogueLabel: 'Epilogue',
};

function makeOptions(root: string, overrides: Partial<MergeOptions> = {}): MergeOptions {
    return {
        root,
        storyFolder:      'Story',
        language:         EN,
        outputTypes:      ['md'],
        includeToc:       false,
        includeSeparators: false,
        outputDir:        'Merged',
        filePrefix:       'Book',
        pandocPath:       'pandoc',
        ...overrides,
    };
}

// ─── getBuiltInUkReplacements ─────────────────────────────────────────────────

describe('getBuiltInUkReplacements()', () => {
    it('returns a non-empty array that includes color → colour', () => {
        const list = getBuiltInUkReplacements();
        expect(list.length).toBeGreaterThan(0);
        expect(list.some(r => r.us === 'color' && r.uk === 'colour')).toBe(true);
    });

    it('returns a copy — mutating the result does not affect subsequent calls', () => {
        const first = getBuiltInUkReplacements();
        first.push({ us: '__test__', uk: '__test__' });
        const second = getBuiltInUkReplacements();
        expect(second.find(r => r.us === '__test__')).toBeUndefined();
    });
});

// ─── mergeBook() — md output only (no pandoc required) ───────────────────────

describe('mergeBook() — md output', () => {
    it('creates a merged .md file containing all chapter content', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I',  'Chapter1.md'), '# Chapter 1\n\nFirst content.\n');
        write(path.join(root, 'Story', 'EN', 'Act II', 'Chapter2.md'), '# Chapter 2\n\nSecond content.\n');

        const result = await mergeBook(makeOptions(root));

        expect(result.outputs).toHaveLength(1);
        const merged = fs.readFileSync(result.outputs[0], 'utf-8');
        expect(merged).toContain('First content.');
        expect(merged).toContain('Second content.');
    });

    it('orders chapters numerically across acts', async () => {
        const root = makeRoot();
        // ch1 and ch2 in Act I (written in reverse order to confirm sorting)
        write(path.join(root, 'Story', 'EN', 'Act I',  'Chapter2.md'), '# Ch2\n\nContent 2.\n');
        write(path.join(root, 'Story', 'EN', 'Act I',  'Chapter1.md'), '# Ch1\n\nContent 1.\n');
        write(path.join(root, 'Story', 'EN', 'Act II', 'Chapter3.md'), '# Ch3\n\nContent 3.\n');

        const merged = fs.readFileSync((await mergeBook(makeOptions(root))).outputs[0], 'utf-8');

        expect(merged.indexOf('Content 1.')).toBeLessThan(merged.indexOf('Content 2.'));
        expect(merged.indexOf('Content 2.')).toBeLessThan(merged.indexOf('Content 3.'));
    });

    it('includes prologue before chapter content', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Prologue.md'),          '# Prologue\n\nPrologue text.\n');
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n\nChapter text.\n');

        const merged = fs.readFileSync((await mergeBook(makeOptions(root))).outputs[0], 'utf-8');

        expect(merged.indexOf('Prologue text.')).toBeLessThan(merged.indexOf('Chapter text.'));
    });

    it('includes epilogue after chapter content', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n\nChapter text.\n');
        write(path.join(root, 'Story', 'EN', 'Epilogue.md'),          '# Epilogue\n\nEpilogue text.\n');

        const merged = fs.readFileSync((await mergeBook(makeOptions(root))).outputs[0], 'utf-8');

        expect(merged.indexOf('Chapter text.')).toBeLessThan(merged.indexOf('Epilogue text.'));
    });

    it('includes a Table of Contents when includeToc is true', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n\nContent.\n');

        const merged = fs.readFileSync(
            (await mergeBook(makeOptions(root, { includeToc: true }))).outputs[0],
            'utf-8',
        );

        expect(merged).toContain('Table of Contents');
    });

    it('inserts HR separators between entries when includeSeparators is true', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n\nContent.\n');

        const merged = fs.readFileSync(
            (await mergeBook(makeOptions(root, { includeSeparators: true }))).outputs[0],
            'utf-8',
        );

        expect(merged).toContain('---');
    });

    it('throws when the language folder is missing', async () => {
        const root = makeRoot();
        // Story/EN/ never created
        await expect(mergeBook(makeOptions(root))).rejects.toThrow(/not found/i);
    });

    it('throws when the language folder exists but contains no markdown files', async () => {
        const root = makeRoot();
        // Empty folder — no act sub-folders, no prologue, no epilogue
        fs.mkdirSync(path.join(root, 'Story', 'EN'), { recursive: true });

        await expect(mergeBook(makeOptions(root))).rejects.toThrow(/No markdown files found/i);
    });

    it('applies dialect word substitutions (color → colour) when dialectCode is set', async () => {
        const root = makeRoot();
        write(
            path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'),
            '# Ch1\n\nThe color of the sky.\n',
        );

        const result = await mergeBook(
            makeOptions(root, {
                dialectCode:    'en-gb',
                ukReplacements: [{ us: 'color', uk: 'colour' }],
            }),
        );

        const merged = fs.readFileSync(result.outputs[0], 'utf-8');
        expect(merged).toContain('colour');
        expect(merged).not.toContain('color');
    });

    it('dialect output filename carries the uppercased dialect code suffix', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n\nContent.\n');

        const result = await mergeBook(
            makeOptions(root, { dialectCode: 'en-gb', ukReplacements: [] }),
        );

        expect(path.basename(result.outputs[0])).toBe('Book_EN-GB_Merged.md');
    });

    it('uses the configured filePrefix in the output filename', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n\nContent.\n');

        const result = await mergeBook(makeOptions(root, { filePrefix: 'MyBook' }));

        expect(path.basename(result.outputs[0])).toBe('MyBook_EN_Merged.md');
    });
});
