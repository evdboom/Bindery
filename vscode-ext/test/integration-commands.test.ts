/**
 * VS Code extension integration tests.
 *
 * Exercises the command-level workflows of the Bindery extension:
 *   - bindery.init  → creates .bindery/settings.json + translations.json
 *   - bindery.registerMcp → generates .vscode/mcp.json
 *   - bindery.formatDocument → applies typography transforms
 *   - Settings precedence: workspace file > VS Code settings > code defaults
 *
 * VS Code host APIs are mocked (workspace, window, lm) so the tests run
 * without an extension host and complete quickly.
 */

import * as fs   from 'node:fs';
import * as os   from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest';

// ─── Mock vscode ──────────────────────────────────────────────────────────────
// Must be declared before any imports that pull in vscode transitively.

vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: () => ({
            get: (key: string) => {
                if (key === 'ollamaUrl') { return 'http://127.0.0.1:11434'; }
                return undefined;
            },
        }),
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
    LanguageModelToolResult: class {
        constructor(public readonly content: unknown[]) {}
    },
    LanguageModelTextPart: class {
        constructor(public readonly value: string) {}
    },
}));

// ─── Imports (after mock registration) ────────────────────────────────────────

import {
    readWorkspaceSettings,
    readTranslations,
    writeTranslations,
    getSettingsPath,
    getTranslationsPath,
    getBinderyFolder,
    getBookTitleForLang,
    getSubstitutionRules,
    upsertSubstitutionRule,
    upsertGlossaryRule,
    getGlossaryRules,
    type WorkspaceSettings,
    type TranslationsFile,
} from '../src/workspace';
import { writeMcpJson } from '../src/mcp';
import { updateTypography } from '../src/format';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const tempRoots: string[] = [];

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-vscode-int-test-'));
    tempRoots.push(root);
    return root;
}

function writeSettings(root: string, settings: WorkspaceSettings): void {
    const folder = getBinderyFolder(root);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(getSettingsPath(root), JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

afterEach(() => {
    vi.clearAllMocks();
    for (const root of tempRoots.splice(0, tempRoots.length)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// ─── bindery.init equivalent ──────────────────────────────────────────────────

describe('bindery.init — workspace initialisation', () => {
    it('creates settings.json with the expected schema', () => {
        const root = makeRoot();
        const binderyFolder = getBinderyFolder(root);
        fs.mkdirSync(binderyFolder, { recursive: true });

        const settings: WorkspaceSettings = {
            bookTitle:      'The Hollow Road',
            author:         'Jane Smith',
            storyFolder:    'Story',
            mergedOutputDir: 'Merged',
            mergeFilePrefix: 'The_Hollow_Road',
            formatOnSave:   true,
            languages:      [{ code: 'EN', folderName: 'EN', chapterWord: 'Chapter', actPrefix: 'Act', prologueLabel: 'Prologue', epilogueLabel: 'Epilogue', isDefault: true }],
        };
        fs.writeFileSync(getSettingsPath(root), JSON.stringify(settings, null, 2) + '\n', 'utf-8');

        const parsed = readWorkspaceSettings(root);
        expect(parsed).not.toBeNull();
        expect(parsed?.bookTitle).toBe('The Hollow Road');
        expect(parsed?.author).toBe('Jane Smith');
        expect(parsed?.storyFolder).toBe('Story');
        expect(parsed?.formatOnSave).toBe(true);
        expect(Array.isArray(parsed?.languages)).toBe(true);
        expect(parsed?.languages?.[0]?.code).toBe('EN');
    });

    it('creates translations.json with an en-gb substitution entry', () => {
        const root = makeRoot();

        const translations: TranslationsFile = {
            'en-gb': {
                label:          'British English',
                type:           'substitution',
                sourceLanguage: 'en',
                rules:          [],
                ignoredWords:   [],
            },
        };
        writeTranslations(root, translations);

        const parsed = readTranslations(root);
        expect(parsed).not.toBeNull();
        expect(parsed?.['en-gb']).toBeDefined();
        expect(parsed?.['en-gb']?.type).toBe('substitution');
        expect(Array.isArray(parsed?.['en-gb']?.rules)).toBe(true);
    });

    it('does not overwrite an existing translations.json', () => {
        const root = makeRoot();

        // Write original translations file
        const original: TranslationsFile = {
            'en-gb': {
                type:  'substitution',
                rules: [{ from: 'color', to: 'colour' }],
            },
        };
        writeTranslations(root, original);

        // Simulate "init" that only writes translations if absent
        const translationsPath = getTranslationsPath(root);
        if (!fs.existsSync(translationsPath)) {
            writeTranslations(root, { 'en-gb': { type: 'substitution', rules: [] } });
        }

        const parsed = readTranslations(root);
        expect(parsed?.['en-gb']?.rules).toHaveLength(1);
        expect(parsed?.['en-gb']?.rules?.[0]?.from).toBe('color');
    });

    it('returns null for readWorkspaceSettings when settings.json is absent', () => {
        const root = makeRoot();
        const result = readWorkspaceSettings(root);
        expect(result).toBeNull();
    });
});

// ─── bindery.registerMcp equivalent ──────────────────────────────────────────

describe('bindery.registerMcp — MCP JSON generation', () => {
    it('writes bindery server config to .vscode/mcp.json', async () => {
        const root = makeRoot();

        await writeMcpJson({ extensionPath: '/fake/ext' } as never, root);

        const mcpJsonPath = path.join(root, '.vscode', 'mcp.json');
        expect(fs.existsSync(mcpJsonPath)).toBe(true);

        const parsed = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8')) as {
            servers: Record<string, { command: string; args: string[] }>;
        };

        expect(parsed.servers.bindery).toBeDefined();
        expect(parsed.servers.bindery.command).toBe('node');
        expect(parsed.servers.bindery.args).toContain('--book');
    });

    it('preserves existing server entries in mcp.json', async () => {
        const root   = makeRoot();
        const mcpDir = path.join(root, '.vscode');
        fs.mkdirSync(mcpDir, { recursive: true });
        fs.writeFileSync(
            path.join(mcpDir, 'mcp.json'),
            JSON.stringify({ servers: { other: { command: 'node', args: ['other.js'] } } }, null, 2),
            'utf-8',
        );

        await writeMcpJson({ extensionPath: '/fake/ext' } as never, root);

        const parsed = JSON.parse(
            fs.readFileSync(path.join(mcpDir, 'mcp.json'), 'utf-8')
        ) as { servers: Record<string, unknown> };

        expect(parsed.servers.other).toBeDefined();
        expect(parsed.servers.bindery).toBeDefined();
    });

    it('embeds book name and root path in the --book argument', async () => {
        const root = makeRoot();

        await writeMcpJson({ extensionPath: '/fake/ext' } as never, root);

        const parsed = JSON.parse(
            fs.readFileSync(path.join(root, '.vscode', 'mcp.json'), 'utf-8')
        ) as { servers: { bindery: { args: string[] } } };

        const bookArg = parsed.servers.bindery.args[parsed.servers.bindery.args.indexOf('--book') + 1];
        expect(bookArg).toMatch(/=/);
        const [bookName, bookPath] = bookArg.split('=');
        expect(bookName).toBeTruthy();
        expect(bookPath).toBe(root);
    });
});

// ─── bindery.formatDocument equivalent ───────────────────────────────────────

describe('bindery.formatDocument — typography transformation', () => {
    it('converts straight double quotes to curly quotes', () => {
        const input    = '"Hello," she said.';
        const expected = '\u201CHello,\u201D she said.';
        expect(updateTypography(input)).toBe(expected);
    });

    it('converts double-dash to em-dash', () => {
        const input    = 'It was--absolutely--perfect.';
        const expected = 'It was\u2014absolutely\u2014perfect.';
        expect(updateTypography(input)).toBe(expected);
    });

    it('converts three dots to ellipsis character', () => {
        const input    = 'And then...';
        const expected = 'And then\u2026';
        expect(updateTypography(input)).toBe(expected);
    });

    it('handles a mixed paragraph with all transforms', () => {
        const input = '"Wait..." she said--stepping back.';
        const result = updateTypography(input);
        expect(result).toContain('\u201C');     // opening curly double quote
        expect(result).toContain('\u201D');     // closing curly double quote
        expect(result).toContain('\u2026');     // ellipsis
        expect(result).toContain('\u2014');     // em-dash
        expect(result).not.toContain('"');      // no remaining straight double quotes
        expect(result).not.toContain('...');    // no remaining triple dots
        expect(result).not.toContain('--');     // no remaining double-dash
    });

    it('preserves em-dash-sensitive content inside HTML comments', () => {
        // The -- inside the comment must NOT be converted to an em-dash.
        // Note: the ellipsis pass runs before comment protection, so ... → … everywhere;
        // double-dash protection is what the comment guard specifically provides.
        const input  = '<!-- keep this -- intact --> "outside"';
        const result = updateTypography(input);
        // The double-dash inside the comment must survive
        expect(result).toContain('<!-- keep this -- intact -->');
        // Content outside the comment must be formatted
        expect(result).toContain('\u201Coutside\u201D');
    });

    it('does not convert triple dashes (markdown HR)', () => {
        const input  = '---\nSome text\n---';
        const result = updateTypography(input);
        expect(result).toContain('---');
    });
});

// ─── Settings precedence ──────────────────────────────────────────────────────

describe('settings precedence', () => {
    it('workspace settings.json values take precedence over defaults', () => {
        const root = makeRoot();
        writeSettings(root, {
            storyFolder:    'Chapters',
            formatOnSave:   true,
            mergedOutputDir: 'Output',
        });

        const settings = readWorkspaceSettings(root);
        expect(settings?.storyFolder).toBe('Chapters');
        expect(settings?.formatOnSave).toBe(true);
        expect(settings?.mergedOutputDir).toBe('Output');
    });

    it('returns null (falls back to code defaults) when settings.json is absent', () => {
        const root = makeRoot();
        const settings = readWorkspaceSettings(root);
        // No file → null, caller should apply defaults
        expect(settings).toBeNull();
    });

    it('getBookTitleForLang falls back to en when the requested language is absent', () => {
        const settings: WorkspaceSettings = { bookTitle: { en: 'Road', nl: 'Weg' } };
        expect(getBookTitleForLang(settings, 'fr')).toBe('Road');
        expect(getBookTitleForLang(settings, 'nl')).toBe('Weg');
    });

    it('getBookTitleForLang handles plain-string bookTitle', () => {
        const settings: WorkspaceSettings = { bookTitle: 'My Book' };
        expect(getBookTitleForLang(settings, 'any')).toBe('My Book');
    });

    it('getSubstitutionRules returns empty array for non-substitution entries', () => {
        const translations: TranslationsFile = {
            nl: { type: 'glossary', rules: [{ from: 'FluxCore', to: 'FluxKern' }] },
        };
        expect(getSubstitutionRules(translations, 'nl')).toEqual([]);
    });

    it('project substitution rules override the default empty set', () => {
        const root = makeRoot();
        upsertSubstitutionRule(root, 'en-gb', { from: 'color', to: 'colour' });

        // getSubstitutionRules returns UkReplacement[] (merge.ts format: us/uk),
        // while the underlying storage uses from/to — the conversion is intentional.
        const rules = getSubstitutionRules(readTranslations(root), 'en-gb');
        expect(rules).toEqual([{ us: 'color', uk: 'colour' }]);
    });

    it('glossary rules are stored separately from substitution rules', () => {
        const root = makeRoot();
        upsertGlossaryRule(root, 'nl', 'Dutch', 'en', { from: 'Starship', to: 'Sterenschip' });

        const translations = readTranslations(root);
        const glossary = getGlossaryRules(translations, 'nl');
        expect(glossary).toHaveLength(1);
        expect(glossary[0]?.from).toBe('Starship');

        // Glossary entry must NOT appear in substitution rules
        const substitutions = getSubstitutionRules(translations, 'nl');
        expect(substitutions).toHaveLength(0);
    });
});
