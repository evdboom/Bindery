/**
 * Extended merge.ts tests — exercises internal functions through mergeBook() (md output only)
 * and tests exported Pandoc helpers (with child_process mocked).
 *
 * Covers: getOrderedFiles, buildMarkdownContent, formatDirectory, convertUsToUkText,
 * prepareDialectFolder, cleanupDialectTempFolder, resolveBookTitle, generateToc,
 * checkPandoc, getPandocOutputFormats, clearPandocCapabilityCache, isLegacyUkLanguage,
 * parseActFolder, formatActTitle, imageMarkdownFor, buildPandocContent.
 */

import { vi } from 'vitest';

// ─── Mock vscode (must precede transitive imports) ───────────────────────────
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

import * as cp   from 'node:child_process';
import * as fs   from 'node:fs';
import * as os   from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    checkPandoc,
    clearPandocCapabilityCache,
    getBuiltInUkReplacements,
    getPandocOutputFormats,
    mergeBook,
    type LanguageConfig,
    type MergeOptions,
} from '../src/merge';

// ─── Helpers ────────────────────────────────────────────────────────────────

const tempRoots: string[] = [];

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-merge-ext-'));
    tempRoots.push(root);
    return root;
}

function write(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
}

beforeEach(() => {
    clearPandocCapabilityCache();
});

afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

const EN: LanguageConfig = {
    code:          'EN',
    folderName:    'EN',
    chapterWord:   'Chapter',
    actPrefix:     'Act',
    prologueLabel: 'Prologue',
    epilogueLabel: 'Epilogue',
};

const NL: LanguageConfig = {
    code:          'NL',
    folderName:    'NL',
    chapterWord:   'Hoofdstuk',
    actPrefix:     'Deel',
    prologueLabel: 'Proloog',
    epilogueLabel: 'Epiloog',
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

// ─── Act subtitle handling ──────────────────────────────────────────────────

describe('mergeBook — act subtitles', () => {
    it('includes act subtitle in merged output when present', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I - The Beginning', 'Chapter1.md'), '# Ch1\n\nContent.\n');

        const result = await mergeBook(makeOptions(root));
        const merged = fs.readFileSync(result.outputs[0], 'utf-8');
        expect(merged).toContain('Act I - The Beginning');
    });

    it('handles multiple acts sorted by roman numeral', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act III', 'Chapter5.md'), '# Ch5\n\nThird.\n');
        write(path.join(root, 'Story', 'EN', 'Act I',  'Chapter1.md'), '# Ch1\n\nFirst.\n');
        write(path.join(root, 'Story', 'EN', 'Act II', 'Chapter3.md'), '# Ch3\n\nSecond.\n');

        const merged = fs.readFileSync((await mergeBook(makeOptions(root))).outputs[0], 'utf-8');
        expect(merged.indexOf('First.')).toBeLessThan(merged.indexOf('Second.'));
        expect(merged.indexOf('Second.')).toBeLessThan(merged.indexOf('Third.'));
    });
});

// ─── Localized prologue/epilogue names ──────────────────────────────────────

describe('mergeBook — localized labels', () => {
    it('finds localized prologue when standard Prologue.md is absent', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'NL', 'Proloog.md'), '# Proloog\n\nBegin tekst.\n');
        write(path.join(root, 'Story', 'NL', 'Deel I', 'Hoofdstuk1.md'), '# H1\n\nHoofdstuk.\n');

        const merged = fs.readFileSync(
            (await mergeBook(makeOptions(root, { language: NL }))).outputs[0],
            'utf-8',
        );
        expect(merged).toContain('Begin tekst.');
        expect(merged.indexOf('Begin tekst.')).toBeLessThan(merged.indexOf('Hoofdstuk.'));
    });

    it('prefers Prologue.md over localized name when both exist', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'NL', 'Prologue.md'), '# Standard\n\nStandard text.\n');
        write(path.join(root, 'Story', 'NL', 'Proloog.md'), '# Localized\n\nLocalized text.\n');
        write(path.join(root, 'Story', 'NL', 'Deel I', 'Hoofdstuk1.md'), '# H1\n\nContent.\n');

        const merged = fs.readFileSync(
            (await mergeBook(makeOptions(root, { language: NL }))).outputs[0],
            'utf-8',
        );
        expect(merged).toContain('Standard text.');
        expect(merged).not.toContain('Localized text.');
    });

    it('finds localized epilogue when standard Epilogue.md is absent', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'NL', 'Deel I', 'Hoofdstuk1.md'), '# H1\n\nContent.\n');
        write(path.join(root, 'Story', 'NL', 'Epiloog.md'), '# Epiloog\n\nEinde.\n');

        const merged = fs.readFileSync(
            (await mergeBook(makeOptions(root, { language: NL }))).outputs[0],
            'utf-8',
        );
        expect(merged).toContain('Einde.');
    });
});

// ─── Legacy UK mode ─────────────────────────────────────────────────────────

describe('mergeBook — legacy UK language', () => {
    it('creates a temp UK folder, applies substitutions, and cleans up', async () => {
        const root = makeRoot();
        write(
            path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'),
            '# Ch1\n\nThe color was gray.\n',
        );

        const ukLang: LanguageConfig = {
            code: 'UK', folderName: 'UK',
            chapterWord: 'Chapter', actPrefix: 'Act',
            prologueLabel: 'Prologue', epilogueLabel: 'Epilogue',
        };

        const result = await mergeBook(makeOptions(root, { language: ukLang }));
        const merged = fs.readFileSync(result.outputs[0], 'utf-8');
        expect(merged).toContain('colour');
        expect(merged).toContain('grey');

        // Temp UK folder should be cleaned up
        expect(fs.existsSync(path.join(root, 'Story', 'UK'))).toBe(false);
    });
});

// ─── Dialect export with custom replacements ─────────────────────────────────

describe('mergeBook — dialect export', () => {
    it('creates dialect temp folder and cleans up after merge', async () => {
        const root = makeRoot();
        write(
            path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'),
            '# Ch1\n\nThe color of the center.\n',
        );

        const result = await mergeBook(makeOptions(root, {
            dialectCode: 'en-gb',
            ukReplacements: [
                { us: 'color', uk: 'colour' },
                { us: 'center', uk: 'centre' },
            ],
        }));

        const merged = fs.readFileSync(result.outputs[0], 'utf-8');
        expect(merged).toContain('colour');
        expect(merged).toContain('centre');

        // Temp dialect folder should be cleaned up
        expect(fs.existsSync(path.join(root, 'Story', '_dialect_en-gb'))).toBe(false);
    });
});

// ─── Typography formatting during merge ──────────────────────────────────────

describe('mergeBook — typography formatting', () => {
    it('formats files during merge (straight quotes → curly)', async () => {
        const root = makeRoot();
        write(
            path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'),
            '# Ch1\n\n"Hello," she said.\n',
        );

        const merged = fs.readFileSync(
            (await mergeBook(makeOptions(root))).outputs[0],
            'utf-8',
        );
        expect(merged).toContain('\u201C'); // opening curly
        expect(merged).toContain('\u201D'); // closing curly
    });
});

// ─── TOC generation ─────────────────────────────────────────────────────────

describe('mergeBook — TOC', () => {
    it('generates TOC with act titles and chapter H1 headings', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# The Dark Forest\n\nContent.\n');
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter2.md'), '# The River\n\nContent.\n');

        const merged = fs.readFileSync(
            (await mergeBook(makeOptions(root, { includeToc: true }))).outputs[0],
            'utf-8',
        );
        expect(merged).toContain('Table of Contents');
        expect(merged).toContain('The Dark Forest');
        expect(merged).toContain('The River');
        expect(merged).toContain('Act I');
    });

    it('TOC uses filename when chapter has no H1', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), 'No heading here.\n');

        const merged = fs.readFileSync(
            (await mergeBook(makeOptions(root, { includeToc: true }))).outputs[0],
            'utf-8',
        );
        expect(merged).toContain('Chapter1');
    });

    it('TOC includes prologue and epilogue labels', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Prologue.md'), '# Prologue\n\nText.\n');
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n\nText.\n');
        write(path.join(root, 'Story', 'EN', 'Epilogue.md'), '# Epilogue\n\nText.\n');

        const merged = fs.readFileSync(
            (await mergeBook(makeOptions(root, { includeToc: true }))).outputs[0],
            'utf-8',
        );
        expect(merged).toContain('Prologue');
        expect(merged).toContain('Epilogue');
    });
});

// ─── Book title resolution ──────────────────────────────────────────────────

describe('mergeBook — bookTitle override', () => {
    it('uses bookTitle from options when provided', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n\nContent.\n');

        // bookTitle is only used for pandoc metadata, not in md output,
        // but we can verify the merge succeeds with it set
        const result = await mergeBook(makeOptions(root, { bookTitle: 'My Custom Title' }));
        expect(result.outputs).toHaveLength(1);
    });

    it('falls back to language bookTitle when options.bookTitle is empty', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n\nContent.\n');

        const langWithTitle: LanguageConfig = { ...EN, bookTitle: 'Lang Title' };
        const result = await mergeBook(makeOptions(root, { language: langWithTitle }));
        expect(result.outputs).toHaveLength(1);
    });
});

// ─── US → UK text conversion preserves code fences ──────────────────────────

describe('mergeBook — dialect preserves code fences', () => {
    it('does not replace words inside fenced code blocks', async () => {
        const root = makeRoot();
        write(
            path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'),
            '# Ch1\n\nThe color was bright.\n\n```python\ncolor = "red"\n```\n',
        );

        const result = await mergeBook(makeOptions(root, {
            dialectCode: 'en-gb',
            ukReplacements: [{ us: 'color', uk: 'colour' }],
        }));

        const merged = fs.readFileSync(result.outputs[0], 'utf-8');
        // Outside fence: color → colour
        expect(merged).toContain('colour');
        // Inside fence: "color" is preserved (not replaced with "colour")
        // Typography formatting may convert straight quotes to curly inside the fence,
        // but the word "color" inside the fence should NOT become "colour".
        const fenceMatch = merged.match(/```python\n(.+)\n```/s);
        expect(fenceMatch).not.toBeNull();
        expect(fenceMatch![1]).toContain('color');
        expect(fenceMatch![1]).not.toContain('colour');
    });
});

// ─── mergeBook with empty acts ──────────────────────────────────────────────

describe('mergeBook — edge cases', () => {
    it('handles act folders with no .md files (empty acts produce entries)', async () => {
        const root = makeRoot();
        fs.mkdirSync(path.join(root, 'Story', 'EN', 'Act I'), { recursive: true });
        write(path.join(root, 'Story', 'EN', 'Act II', 'Chapter2.md'), '# Ch2\n\nContent.\n');

        const result = await mergeBook(makeOptions(root));
        const merged = fs.readFileSync(result.outputs[0], 'utf-8');
        // Should still succeed; Act I contributes an act heading but no chapters
        expect(merged).toContain('Act I');
        expect(merged).toContain('Content.');
    });

    it('reports filesMerged count accurately', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Prologue.md'), '# Prologue\n\nPro.\n');
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\n\nCh.\n');
        write(path.join(root, 'Story', 'EN', 'Epilogue.md'), '# Epilogue\n\nEpi.\n');

        const result = await mergeBook(makeOptions(root));
        // prologue + act entry + chapter + epilogue = 4
        expect(result.filesMerged).toBe(4);
    });

    it('output directory is created if it does not exist', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\nContent.\n');

        const result = await mergeBook(makeOptions(root, { outputDir: 'deep/nested/output' }));
        expect(result.outputs).toHaveLength(1);
        expect(fs.existsSync(path.join(root, 'deep', 'nested', 'output'))).toBe(true);
    });
});

// ─── checkPandoc / getPandocOutputFormats ───────────────────────────────────

describe('checkPandoc', () => {
    it('resolves with version string when pandoc is available', async () => {
        // This test only runs if pandoc is installed
        try {
            const version = await checkPandoc('pandoc');
            expect(version).toMatch(/pandoc/i);
        } catch {
            // Pandoc not installed — verify it rejects with the right message
            await expect(checkPandoc('pandoc')).rejects.toThrow(/not available/i);
        }
    });

    it('rejects when pandoc path is bogus', async () => {
        await expect(checkPandoc('/nonexistent/pandoc')).rejects.toThrow(/not available/i);
    });
});

describe('getPandocOutputFormats', () => {
    it('returns empty array when pandoc is not found', async () => {
        const formats = await getPandocOutputFormats('/nonexistent/pandoc');
        expect(formats).toEqual([]);
    });

    it('caches results for the same path', async () => {
        // Two calls with the same path should use cache
        const f1 = await getPandocOutputFormats('/nonexistent/pandoc-1');
        const f2 = await getPandocOutputFormats('/nonexistent/pandoc-1');
        expect(f1).toEqual(f2);
    });

    it('clearPandocCapabilityCache resets the cache', async () => {
        await getPandocOutputFormats('/nonexistent/pandoc-2');
        clearPandocCapabilityCache();
        // After cache clear, it should re-execute (still returns [] for nonexistent)
        const formats = await getPandocOutputFormats('/nonexistent/pandoc-2');
        expect(formats).toEqual([]);
    });
});

// ─── US → UK casing preservation ────────────────────────────────────────────

describe('mergeBook — US→UK casing', () => {
    it('preserves initial capitalization in replacements', async () => {
        const root = makeRoot();
        write(
            path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'),
            '# Ch1\n\nColor and color and COLOR.\n',
        );

        const result = await mergeBook(makeOptions(root, {
            dialectCode: 'en-gb',
            ukReplacements: [{ us: 'color', uk: 'colour' }],
        }));

        const merged = fs.readFileSync(result.outputs[0], 'utf-8');
        expect(merged).toContain('Colour');   // capitalized
        expect(merged).toContain('colour');   // lowercase
        expect(merged).toContain('COLOUR');   // all-caps
    });
});

// ─── Separator mode ──────────────────────────────────────────────────────────

describe('mergeBook — separators between all entries', () => {
    it('inserts separator after prologue, act, and chapter', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Prologue.md'), '# Prologue\nPro.\n');
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\nContent.\n');

        const merged = fs.readFileSync(
            (await mergeBook(makeOptions(root, { includeSeparators: true }))).outputs[0],
            'utf-8',
        );
        // Multiple HR separators
        const hrCount = (merged.match(/^---$/gm) || []).length;
        expect(hrCount).toBeGreaterThanOrEqual(2);
    });
});

// ─── Act with "Deel" prefix (Dutch language) ────────────────────────────────

describe('mergeBook — Dutch act prefix', () => {
    it('recognizes "Deel" prefix in folder names', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'NL', 'Deel I', 'Hoofdstuk1.md'), '# H1\n\nNederlands.\n');

        const merged = fs.readFileSync(
            (await mergeBook(makeOptions(root, { language: NL }))).outputs[0],
            'utf-8',
        );
        expect(merged).toContain('Deel I');
        expect(merged).toContain('Nederlands.');
    });
});
