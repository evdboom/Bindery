/**
 * Extended workspace.ts tests — covers functions not yet tested:
 * readWorkspaceSettings, getDefaultLanguage, getDialectsForLanguage, getIgnoredWords,
 * addIgnoredWords, upsertGlossaryRule, getGlossaryRules, resolveEntry (UK-like fallback),
 * writeTranslations, getBookTitleForLang edge cases.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    addIgnoredWords,
    getBinderyFolder,
    getBookTitleForLang,
    getDefaultLanguage,
    getDialectsForLanguage,
    getGlossaryRules,
    getIgnoredWords,
    getSettingsPath,
    getSubstitutionRules,
    getTranslationsPath,
    readTranslations,
    readWorkspaceSettings,
    upsertGlossaryRule,
    upsertSubstitutionRule,
    writeTranslations,
    type TranslationsFile,
    type WorkspaceSettings,
} from '../src/workspace';

const tempRoots: string[] = [];

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-ws-ext-test-'));
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

// ─── Path helpers ────────────────────────────────────────────────────────────

describe('path helpers', () => {
    it('getBinderyFolder returns .bindery path', () => {
        expect(getBinderyFolder('/root')).toBe(path.join('/root', '.bindery'));
    });

    it('getSettingsPath returns settings.json path', () => {
        expect(getSettingsPath('/root')).toContain('settings.json');
    });

    it('getTranslationsPath returns translations.json path', () => {
        expect(getTranslationsPath('/root')).toContain('translations.json');
    });
});

// ─── readWorkspaceSettings ───────────────────────────────────────────────────

describe('readWorkspaceSettings', () => {
    it('returns null when .bindery/settings.json does not exist', () => {
        const root = makeRoot();
        expect(readWorkspaceSettings(root)).toBeNull();
    });

    it('returns parsed settings when file exists', () => {
        const root = makeRoot();
        write(
            path.join(root, '.bindery', 'settings.json'),
            JSON.stringify({ bookTitle: 'Test', author: 'Alice', storyFolder: 'Story' })
        );

        const settings = readWorkspaceSettings(root);
        expect(settings).not.toBeNull();
        expect(settings!.bookTitle).toBe('Test');
        expect(settings!.author).toBe('Alice');
    });

    it('returns null for malformed JSON', () => {
        const root = makeRoot();
        write(path.join(root, '.bindery', 'settings.json'), 'NOT JSON');

        expect(readWorkspaceSettings(root)).toBeNull();
    });

    it('reads languages array from settings', () => {
        const root = makeRoot();
        write(
            path.join(root, '.bindery', 'settings.json'),
            JSON.stringify({
                languages: [
                    { code: 'EN', folderName: 'EN', chapterWord: 'Chapter', actPrefix: 'Act', prologueLabel: 'Prologue', epilogueLabel: 'Epilogue', isDefault: true },
                    { code: 'NL', folderName: 'NL', chapterWord: 'Hoofdstuk', actPrefix: 'Deel', prologueLabel: 'Proloog', epilogueLabel: 'Epiloog' },
                ]
            })
        );

        const settings = readWorkspaceSettings(root);
        expect(settings!.languages).toHaveLength(2);
    });
});

// ─── readTranslations ────────────────────────────────────────────────────────

describe('readTranslations', () => {
    it('returns null when translations.json does not exist', () => {
        const root = makeRoot();
        expect(readTranslations(root)).toBeNull();
    });

    it('returns null for malformed JSON', () => {
        const root = makeRoot();
        write(path.join(root, '.bindery', 'translations.json'), '{{invalid');
        expect(readTranslations(root)).toBeNull();
    });
});

// ─── writeTranslations ──────────────────────────────────────────────────────

describe('writeTranslations', () => {
    it('creates .bindery directory and writes translations', () => {
        const root = makeRoot();
        const data: TranslationsFile = {
            'en-gb': { type: 'substitution', rules: [{ from: 'a', to: 'b' }] },
        };

        writeTranslations(root, data);

        const on_disk = readTranslations(root);
        expect(on_disk).not.toBeNull();
        expect(on_disk!['en-gb'].rules![0].from).toBe('a');
    });
});

// ─── getBookTitleForLang — edge cases ────────────────────────────────────────

describe('getBookTitleForLang', () => {
    it('returns undefined for null settings', () => {
        expect(getBookTitleForLang(null, 'en')).toBeUndefined();
    });

    it('returns undefined when bookTitle is absent', () => {
        expect(getBookTitleForLang({}, 'en')).toBeUndefined();
    });

    it('returns string bookTitle directly', () => {
        expect(getBookTitleForLang({ bookTitle: 'My Book' }, 'en')).toBe('My Book');
    });

    it('returns undefined for empty string bookTitle', () => {
        expect(getBookTitleForLang({ bookTitle: '' }, 'en')).toBeUndefined();
    });

    it('resolves per-language title with exact match', () => {
        const settings: WorkspaceSettings = {
            bookTitle: { en: 'Road', nl: 'Weg', fr: 'Route' },
        };
        expect(getBookTitleForLang(settings, 'nl')).toBe('Weg');
        expect(getBookTitleForLang(settings, 'fr')).toBe('Route');
    });

    it('falls back to en when specific language is not found', () => {
        const settings: WorkspaceSettings = {
            bookTitle: { en: 'Road' },
        };
        expect(getBookTitleForLang(settings, 'de')).toBe('Road');
    });

    it('returns undefined when map has no matching language and no en', () => {
        const settings: WorkspaceSettings = {
            bookTitle: { fr: 'Route' },
        };
        expect(getBookTitleForLang(settings, 'de')).toBeUndefined();
    });

    it('is case-insensitive for language codes', () => {
        const settings: WorkspaceSettings = {
            bookTitle: { en: 'Road', nl: 'Weg' },
        };
        expect(getBookTitleForLang(settings, 'NL')).toBe('Weg');
    });
});

// ─── getDefaultLanguage ──────────────────────────────────────────────────────

describe('getDefaultLanguage', () => {
    it('returns undefined for null settings', () => {
        expect(getDefaultLanguage(null)).toBeUndefined();
    });

    it('returns undefined when languages is empty', () => {
        expect(getDefaultLanguage({ languages: [] })).toBeUndefined();
    });

    it('returns undefined when languages is absent', () => {
        expect(getDefaultLanguage({})).toBeUndefined();
    });

    it('returns the language marked isDefault', () => {
        const settings: WorkspaceSettings = {
            languages: [
                { code: 'NL', folderName: 'NL', chapterWord: 'H', actPrefix: 'D', prologueLabel: 'P', epilogueLabel: 'E' },
                { code: 'EN', folderName: 'EN', chapterWord: 'C', actPrefix: 'A', prologueLabel: 'P', epilogueLabel: 'E', isDefault: true },
            ],
        };
        expect(getDefaultLanguage(settings)!.code).toBe('EN');
    });

    it('returns first language when none marked as default', () => {
        const settings: WorkspaceSettings = {
            languages: [
                { code: 'NL', folderName: 'NL', chapterWord: 'H', actPrefix: 'D', prologueLabel: 'P', epilogueLabel: 'E' },
                { code: 'EN', folderName: 'EN', chapterWord: 'C', actPrefix: 'A', prologueLabel: 'P', epilogueLabel: 'E' },
            ],
        };
        expect(getDefaultLanguage(settings)!.code).toBe('NL');
    });
});

// ─── getDialectsForLanguage ──────────────────────────────────────────────────

describe('getDialectsForLanguage', () => {
    it('returns empty array for null settings', () => {
        expect(getDialectsForLanguage(null, 'EN')).toEqual([]);
    });

    it('returns empty array when language has no dialects', () => {
        const settings: WorkspaceSettings = {
            languages: [
                { code: 'EN', folderName: 'EN', chapterWord: 'C', actPrefix: 'A', prologueLabel: 'P', epilogueLabel: 'E' },
            ],
        };
        expect(getDialectsForLanguage(settings, 'EN')).toEqual([]);
    });

    it('returns dialects for matching language (case-insensitive)', () => {
        const settings: WorkspaceSettings = {
            languages: [
                {
                    code: 'EN', folderName: 'EN',
                    chapterWord: 'C', actPrefix: 'A', prologueLabel: 'P', epilogueLabel: 'E',
                    dialects: [{ code: 'en-gb', label: 'British English' }],
                },
            ],
        };
        const dialects = getDialectsForLanguage(settings, 'en');
        expect(dialects).toHaveLength(1);
        expect(dialects[0].code).toBe('en-gb');
    });

    it('returns empty array for unmatched language code', () => {
        const settings: WorkspaceSettings = {
            languages: [
                { code: 'EN', folderName: 'EN', chapterWord: 'C', actPrefix: 'A', prologueLabel: 'P', epilogueLabel: 'E' },
            ],
        };
        expect(getDialectsForLanguage(settings, 'NL')).toEqual([]);
    });
});

// ─── getIgnoredWords ─────────────────────────────────────────────────────────

describe('getIgnoredWords', () => {
    it('returns empty set for null translations', () => {
        expect(getIgnoredWords(null, 'en-gb').size).toBe(0);
    });

    it('returns ignored words as a lowercase set', () => {
        const translations: TranslationsFile = {
            'en-gb': {
                type: 'substitution',
                ignoredWords: ['FluxCore', 'NETHER', '  padded  '],
            },
        };
        const words = getIgnoredWords(translations, 'en-gb');
        expect(words.has('fluxcore')).toBe(true);
        expect(words.has('nether')).toBe(true);
        expect(words.has('padded')).toBe(true);
        expect(words.size).toBe(3);
    });

    it('skips empty/whitespace-only words', () => {
        const translations: TranslationsFile = {
            'en-gb': {
                type: 'substitution',
                ignoredWords: ['', '  ', 'valid'],
            },
        };
        const words = getIgnoredWords(translations, 'en-gb');
        expect(words.size).toBe(1);
        expect(words.has('valid')).toBe(true);
    });

    it('returns empty set for unknown language key', () => {
        const translations: TranslationsFile = {
            'en-gb': { type: 'substitution', ignoredWords: ['foo'] },
        };
        expect(getIgnoredWords(translations, 'nl').size).toBe(0);
    });
});

// ─── addIgnoredWords ─────────────────────────────────────────────────────────

describe('addIgnoredWords', () => {
    it('creates entry and adds words when no translations exist', () => {
        const root = makeRoot();
        const added = addIgnoredWords(root, 'en-gb', ['FluxCore', 'Nether']);
        expect(added).toBe(2);

        const translations = readTranslations(root);
        expect(translations!['en-gb'].ignoredWords).toEqual(['fluxcore', 'nether']);
    });

    it('skips duplicate words (case-insensitive)', () => {
        const root = makeRoot();
        addIgnoredWords(root, 'en-gb', ['flux']);
        const added = addIgnoredWords(root, 'en-gb', ['FLUX', 'new']);
        expect(added).toBe(1); // only 'new' is new
    });

    it('skips empty/whitespace words', () => {
        const root = makeRoot();
        const added = addIgnoredWords(root, 'en-gb', ['', '  ', 'valid']);
        expect(added).toBe(1);
    });

    it('preserves existing entry type and rules', () => {
        const root = makeRoot();
        upsertSubstitutionRule(root, 'en-gb', { from: 'color', to: 'colour' });
        addIgnoredWords(root, 'en-gb', ['flux']);

        const translations = readTranslations(root);
        expect(translations!['en-gb'].type).toBe('substitution');
        expect(translations!['en-gb'].rules).toHaveLength(1);
        expect(translations!['en-gb'].ignoredWords).toContain('flux');
    });
});

// ─── upsertGlossaryRule ──────────────────────────────────────────────────────

describe('upsertGlossaryRule', () => {
    it('creates a glossary entry when none exists', () => {
        const root = makeRoot();
        upsertGlossaryRule(root, 'nl', 'Dutch', 'en', { from: 'FluxCore', to: 'FluxKern' });

        const translations = readTranslations(root);
        expect(translations!['nl'].type).toBe('glossary');
        expect(translations!['nl'].label).toBe('Dutch');
        expect(translations!['nl'].sourceLanguage).toBe('en');
        expect(translations!['nl'].rules![0].from).toBe('FluxCore');
    });

    it('updates existing rule by case-insensitive from match', () => {
        const root = makeRoot();
        upsertGlossaryRule(root, 'nl', 'Dutch', 'en', { from: 'FluxCore', to: 'FluxKern' });
        upsertGlossaryRule(root, 'nl', 'Dutch', 'en', { from: 'fluxcore', to: 'VluxKern' });

        const translations = readTranslations(root);
        expect(translations!['nl'].rules).toHaveLength(1);
        expect(translations!['nl'].rules![0].to).toBe('VluxKern');
    });

    it('sorts rules alphabetically by from', () => {
        const root = makeRoot();
        upsertGlossaryRule(root, 'nl', 'Dutch', 'en', { from: 'Zeta', to: 'Z' });
        upsertGlossaryRule(root, 'nl', 'Dutch', 'en', { from: 'Alpha', to: 'A' });

        const translations = readTranslations(root);
        expect(translations!['nl'].rules![0].from).toBe('Alpha');
        expect(translations!['nl'].rules![1].from).toBe('Zeta');
    });
});

// ─── getGlossaryRules ────────────────────────────────────────────────────────

describe('getGlossaryRules', () => {
    it('returns empty array for null translations', () => {
        expect(getGlossaryRules(null, 'nl')).toEqual([]);
    });

    it('returns rules for glossary entries', () => {
        const translations: TranslationsFile = {
            nl: { type: 'glossary', rules: [{ from: 'Flux', to: 'Stroom' }] },
        };
        const rules = getGlossaryRules(translations, 'nl');
        expect(rules).toEqual([{ from: 'Flux', to: 'Stroom' }]);
    });

    it('filters out rules with empty from or to', () => {
        const translations: TranslationsFile = {
            nl: { type: 'glossary', rules: [
                { from: 'Good', to: 'Goed' },
                { from: '', to: 'empty' },
                { from: 'missing', to: '' },
            ]},
        };
        const rules = getGlossaryRules(translations, 'nl');
        expect(rules).toHaveLength(1);
        expect(rules[0].from).toBe('Good');
    });

    it('returns empty array for unknown key', () => {
        const translations: TranslationsFile = {
            nl: { type: 'glossary', rules: [{ from: 'A', to: 'B' }] },
        };
        expect(getGlossaryRules(translations, 'fr')).toEqual([]);
    });
});

// ─── resolveEntry — UK-like fallback ─────────────────────────────────────────

describe('getSubstitutionRules — UK-like code fallback', () => {
    it('resolves "uk" to en-gb entry', () => {
        const translations: TranslationsFile = {
            'en-gb': { type: 'substitution', rules: [{ from: 'color', to: 'colour' }] },
        };
        const rules = getSubstitutionRules(translations, 'uk');
        expect(rules).toEqual([{ us: 'color', uk: 'colour' }]);
    });

    it('resolves "en-uk" to en-gb entry', () => {
        const translations: TranslationsFile = {
            'en-gb': { type: 'substitution', rules: [{ from: 'color', to: 'colour' }] },
        };
        expect(getSubstitutionRules(translations, 'en-uk')).toHaveLength(1);
    });

    it('direct match takes priority over UK-like fallback', () => {
        const translations: TranslationsFile = {
            'uk':    { type: 'substitution', rules: [{ from: 'a', to: 'b' }] },
            'en-gb': { type: 'substitution', rules: [{ from: 'c', to: 'd' }] },
        };
        const rules = getSubstitutionRules(translations, 'uk');
        expect(rules[0].us).toBe('a');
    });
});

// ─── upsertSubstitutionRule — type mismatch ──────────────────────────────────

describe('upsertSubstitutionRule — error cases', () => {
    it('throws when entry type is glossary, not substitution', () => {
        const root = makeRoot();
        upsertGlossaryRule(root, 'nl', 'Dutch', 'en', { from: 'A', to: 'B' });

        expect(() => {
            upsertSubstitutionRule(root, 'nl', { from: 'color', to: 'colour' });
        }).toThrow(/type 'glossary'/);
    });

    it('updates existing rule in-place', () => {
        const root = makeRoot();
        upsertSubstitutionRule(root, 'en-gb', { from: 'color', to: 'colour' });
        upsertSubstitutionRule(root, 'en-gb', { from: 'color', to: 'coleur' });

        const translations = readTranslations(root);
        const rules = translations!['en-gb'].rules!;
        expect(rules).toHaveLength(1);
        expect(rules[0].to).toBe('coleur');
    });
});
