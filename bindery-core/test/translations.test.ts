/**
 * Unit tests for bindery-core/src/translations.ts
 *
 * Tests read/write helpers and all mutators.
 * Mirror of vscode-ext/test/workspace.test.ts and workspace-extended.test.ts
 * (translations subset).
 */

import * as fs   from 'node:fs';
import * as os   from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    addIgnoredWords,
    getGlossaryRules,
    getIgnoredWords,
    getSubstitutionRules,
    readTranslations,
    upsertGlossaryRule,
    upsertSubstitutionRule,
    writeTranslations,
    type TranslationsFile,
} from '../src/translations';

const tempRoots: string[] = [];

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-core-trans-test-'));
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

// ─── readTranslations ─────────────────────────────────────────────────────────

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

    it('returns parsed translations when file exists', () => {
        const root = makeRoot();
        const data: TranslationsFile = {
            'en-gb': { type: 'substitution', rules: [{ from: 'color', to: 'colour' }] },
        };
        write(path.join(root, '.bindery', 'translations.json'), JSON.stringify(data));
        const translations = readTranslations(root);
        expect(translations).not.toBeNull();
        expect(translations!['en-gb'].rules![0].from).toBe('color');
    });
});

// ─── writeTranslations ────────────────────────────────────────────────────────

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

// ─── getSubstitutionRules ─────────────────────────────────────────────────────

describe('getSubstitutionRules', () => {
    it('returns only substitution entries as replacement rules', () => {
        const translations: TranslationsFile = {
            'en-gb': { type: 'substitution', rules: [{ from: 'color', to: 'colour' }] },
            nl:      { type: 'glossary',     rules: [{ from: 'FluxCore', to: 'FluxKern' }] },
        };
        expect(getSubstitutionRules(translations, 'en-gb')).toEqual([{ us: 'color', uk: 'colour' }]);
        expect(getSubstitutionRules(translations, 'nl')).toEqual([]);
    });

    it('returns empty array for null translations', () => {
        expect(getSubstitutionRules(null, 'en-gb')).toEqual([]);
    });

    it('resolves "uk" to en-gb entry (UK-like fallback)', () => {
        const translations: TranslationsFile = {
            'en-gb': { type: 'substitution', rules: [{ from: 'color', to: 'colour' }] },
        };
        expect(getSubstitutionRules(translations, 'uk')).toEqual([{ us: 'color', uk: 'colour' }]);
    });

    it('resolves "en-uk" to en-gb entry', () => {
        const translations: TranslationsFile = {
            'en-gb': { type: 'substitution', rules: [{ from: 'color', to: 'colour' }] },
        };
        expect(getSubstitutionRules(translations, 'en-uk')).toHaveLength(1);
    });

    it('direct match takes priority over UK-like fallback', () => {
        const translations: TranslationsFile = {
            uk:      { type: 'substitution', rules: [{ from: 'a', to: 'b' }] },
            'en-gb': { type: 'substitution', rules: [{ from: 'c', to: 'd' }] },
        };
        expect(getSubstitutionRules(translations, 'uk')[0].us).toBe('a');
    });
});

// ─── getIgnoredWords ──────────────────────────────────────────────────────────

describe('getIgnoredWords', () => {
    it('returns empty set for null translations', () => {
        expect(getIgnoredWords(null, 'en-gb').size).toBe(0);
    });

    it('returns ignored words as a lowercase set', () => {
        const translations: TranslationsFile = {
            'en-gb': { type: 'substitution', ignoredWords: ['FluxCore', 'NETHER', '  padded  '] },
        };
        const words = getIgnoredWords(translations, 'en-gb');
        expect(words.has('fluxcore')).toBe(true);
        expect(words.has('nether')).toBe(true);
        expect(words.has('padded')).toBe(true);
        expect(words.size).toBe(3);
    });

    it('skips empty/whitespace-only words', () => {
        const translations: TranslationsFile = {
            'en-gb': { type: 'substitution', ignoredWords: ['', '  ', 'valid'] },
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

// ─── addIgnoredWords ──────────────────────────────────────────────────────────

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
        expect(added).toBe(1);
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

// ─── upsertSubstitutionRule ───────────────────────────────────────────────────

describe('upsertSubstitutionRule', () => {
    it('upserts rules and keeps them sorted', () => {
        const root = makeRoot();
        upsertSubstitutionRule(root, 'en-gb', { from: 'color', to: 'colour' });
        upsertSubstitutionRule(root, 'en-gb', { from: 'analyze', to: 'analyse' });
        const translations = readTranslations(root);
        const rules = translations!['en-gb'].rules ?? [];
        expect(rules.map(r => r.from)).toEqual(['analyze', 'color']);
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

    it('throws when entry type is glossary, not substitution', () => {
        const root = makeRoot();
        upsertGlossaryRule(root, 'nl', 'Dutch', 'en', { from: 'A', to: 'B' });
        expect(() => {
            upsertSubstitutionRule(root, 'nl', { from: 'color', to: 'colour' });
        }).toThrow(/type 'glossary'/);
    });
});

// ─── upsertGlossaryRule ───────────────────────────────────────────────────────

describe('upsertGlossaryRule', () => {
    it('throws when langKey already exists as a substitution entry', () => {
        const root = makeRoot();
        upsertSubstitutionRule(root, 'en-gb', { from: 'color', to: 'colour' });
        expect(() => {
            upsertGlossaryRule(root, 'en-gb', 'British', 'en', { from: 'FluxCore', to: 'FluxKern' });
        }).toThrow(/type 'substitution'/);
    });

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

// ─── getGlossaryRules ─────────────────────────────────────────────────────────

describe('getGlossaryRules', () => {
    it('returns empty array for null translations', () => {
        expect(getGlossaryRules(null, 'nl')).toEqual([]);
    });

    it('returns empty array for entries with non-glossary type', () => {
        const translations: TranslationsFile = {
            'en-gb': { type: 'substitution', rules: [{ from: 'color', to: 'colour' }] },
        };
        expect(getGlossaryRules(translations, 'en-gb')).toEqual([]);
    });

    it('returns rules for glossary entries', () => {
        const translations: TranslationsFile = {
            nl: { type: 'glossary', rules: [{ from: 'Flux', to: 'Stroom' }] },
        };
        expect(getGlossaryRules(translations, 'nl')).toEqual([{ from: 'Flux', to: 'Stroom' }]);
    });

    it('filters out rules with empty from or to', () => {
        const translations: TranslationsFile = {
            nl: { type: 'glossary', rules: [
                { from: 'Good', to: 'Goed' },
                { from: '', to: 'empty' },
                { from: 'missing', to: '' },
            ] },
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
