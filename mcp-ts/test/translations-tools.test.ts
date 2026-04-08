import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    toolGetTranslation,
    toolAddTranslation,
    toolAddDialect,
    toolGetDialect,
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

// ─── toolGetTranslation ───────────────────────────────────────────────────────

describe('toolGetTranslation', () => {
    it('lists all glossary rules when no word filter', () => {
        const root = makeRoot();
        const translations = {
            nl: { type: 'glossary', sourceLanguage: 'en', rules: [{ from: 'cat', to: 'kat' }, { from: 'dog', to: 'hond' }] },
        };
        write(path.join(root, '.bindery', 'translations.json'), JSON.stringify(translations) + '\n');

        const result = toolGetTranslation(root, { language: 'nl' });
        expect(result).toContain('cat');
        expect(result).toContain('kat');
        expect(result).toContain('dog');
        expect(result).toContain('hond');
    });

    it('matches language key case-insensitively', () => {
        const root = makeRoot();
        const translations = {
            nl: { type: 'glossary', sourceLanguage: 'en', rules: [{ from: 'cat', to: 'kat' }] },
        };
        write(path.join(root, '.bindery', 'translations.json'), JSON.stringify(translations) + '\n');

        const result = toolGetTranslation(root, { language: 'NL' });
        expect(result).toContain('cat');
    });

    it('returns error when substitution entry is requested as glossary', () => {
        const root = makeRoot();
        const translations = {
            'en-gb': { type: 'substitution', sourceLanguage: 'en', rules: [{ from: 'color', to: 'colour' }] },
        };
        write(path.join(root, '.bindery', 'translations.json'), JSON.stringify(translations) + '\n');

        const result = toolGetTranslation(root, { language: 'en-gb', type: 'glossary' });
        expect(result).toContain('substitution');
        expect(result).toContain('get_dialect');
    });

    it('performs stem lookup for word query', () => {
        const root = makeRoot();
        const translations = {
            nl: { type: 'glossary', sourceLanguage: 'en', rules: [{ from: 'cat', to: 'kat' }] },
        };
        write(path.join(root, '.bindery', 'translations.json'), JSON.stringify(translations) + '\n');

        // 'cats' → stems include 'cat'
        const result = toolGetTranslation(root, { language: 'nl', word: 'cats' });
        expect(result).toContain('cat');
        expect(result).toContain('kat');
    });

    it('returns not-found message when word is absent', () => {
        const root = makeRoot();
        const translations = {
            nl: { type: 'glossary', sourceLanguage: 'en', rules: [{ from: 'cat', to: 'kat' }] },
        };
        write(path.join(root, '.bindery', 'translations.json'), JSON.stringify(translations) + '\n');

        const result = toolGetTranslation(root, { language: 'nl', word: 'elephant' });
        expect(result).toContain('not found');
    });

    it('returns error when translations.json is missing', () => {
        const root = makeRoot();
        const result = toolGetTranslation(root, { language: 'nl' });
        expect(result).toContain('No translations.json found');
    });

    it('returns error on malformed JSON', () => {
        const root = makeRoot();
        write(path.join(root, '.bindery', 'translations.json'), '{ invalid json ');

        const result = toolGetTranslation(root, { language: 'nl' });
        expect(result).toContain('Error');
    });

    it('includes available languages in not-found error', () => {
        const root = makeRoot();
        const translations = {
            nl: { type: 'glossary', sourceLanguage: 'en', rules: [] },
            fr: { type: 'glossary', sourceLanguage: 'en', rules: [] },
        };
        write(path.join(root, '.bindery', 'translations.json'), JSON.stringify(translations) + '\n');

        const result = toolGetTranslation(root, { language: 'de' });
        expect(result).toContain('Available');
        expect(result).toContain('nl');
        expect(result).toContain('fr');
    });
});

// ─── toolAddTranslation ───────────────────────────────────────────────────────

describe('toolAddTranslation', () => {
    it('creates translations.json and adds a glossary entry', () => {
        const root = makeRoot();
        const result = toolAddTranslation(root, { targetLangCode: 'nl', from: 'castle', to: 'kasteel' });

        expect(result).toContain('Added');
        expect(result).toContain('castle');
        expect(result).toContain('kasteel');
        expect(fs.existsSync(path.join(root, '.bindery', 'translations.json'))).toBe(true);
    });

    it('updates (not duplicates) when rule already exists', () => {
        const root = makeRoot();
        toolAddTranslation(root, { targetLangCode: 'nl', from: 'castle', to: 'kasteel' });
        const result = toolAddTranslation(root, { targetLangCode: 'nl', from: 'castle', to: 'burcht' });

        expect(result).toContain('Updated');

        const trans = JSON.parse(
            fs.readFileSync(path.join(root, '.bindery', 'translations.json'), 'utf-8')
        ) as { nl: { rules: Array<{ from: string; to: string }> } };
        const rules = trans.nl.rules.filter(r => r.from === 'castle');
        expect(rules).toHaveLength(1);
        expect(rules[0].to).toBe('burcht');
    });

    it('sorts rules alphabetically', () => {
        const root = makeRoot();
        toolAddTranslation(root, { targetLangCode: 'nl', from: 'zebra', to: 'zebra' });
        toolAddTranslation(root, { targetLangCode: 'nl', from: 'apple', to: 'appel' });

        const trans = JSON.parse(
            fs.readFileSync(path.join(root, '.bindery', 'translations.json'), 'utf-8')
        ) as { nl: { rules: Array<{ from: string }> } };
        expect(trans.nl.rules[0].from).toBe('apple');
        expect(trans.nl.rules[1].from).toBe('zebra');
    });

    it('returns error for empty from or to', () => {
        const root = makeRoot();
        expect(toolAddTranslation(root, { targetLangCode: 'nl', from: '', to: 'iets' })).toContain('Error');
        expect(toolAddTranslation(root, { targetLangCode: 'nl', from: 'something', to: '' })).toContain('Error');
    });

    it('uses the first language from settings as sourceLanguage', () => {
        const root = makeRoot();
        write(
            path.join(root, '.bindery', 'settings.json'),
            JSON.stringify({ languages: [{ code: 'FR', isDefault: true }] }) + '\n'
        );
        toolAddTranslation(root, { targetLangCode: 'de', from: 'chat', to: 'Katze' });

        const trans = JSON.parse(
            fs.readFileSync(path.join(root, '.bindery', 'translations.json'), 'utf-8')
        ) as { de: { sourceLanguage: string } };
        expect(trans.de.sourceLanguage).toBe('fr');
    });
});

// ─── toolAddDialect ───────────────────────────────────────────────────────────

describe('toolAddDialect', () => {
    it('creates a substitution entry', () => {
        const root = makeRoot();
        const result = toolAddDialect(root, { dialectCode: 'en-gb', from: 'color', to: 'colour' });

        expect(result).toContain('Added');
        expect(result).toContain('color');
        expect(result).toContain('colour');
    });

    it('stores from in lowercase', () => {
        const root = makeRoot();
        toolAddDialect(root, { dialectCode: 'en-gb', from: 'COLOR', to: 'colour' });

        const trans = JSON.parse(
            fs.readFileSync(path.join(root, '.bindery', 'translations.json'), 'utf-8')
        ) as { 'en-gb': { rules: Array<{ from: string }> } };
        expect(trans['en-gb'].rules[0].from).toBe('color');
    });

    it('updates without duplicating an existing rule', () => {
        const root = makeRoot();
        toolAddDialect(root, { dialectCode: 'en-gb', from: 'color', to: 'colour' });
        const result = toolAddDialect(root, { dialectCode: 'en-gb', from: 'color', to: 'Colour' });

        expect(result).toContain('Updated');

        const trans = JSON.parse(
            fs.readFileSync(path.join(root, '.bindery', 'translations.json'), 'utf-8')
        ) as { 'en-gb': { rules: Array<{ from: string; to: string }> } };
        const rules = trans['en-gb'].rules.filter(r => r.from === 'color');
        expect(rules).toHaveLength(1);
        expect(rules[0].to).toBe('Colour');
    });

    it('returns error when the entry has type glossary', () => {
        const root = makeRoot();
        const translations = { 'en-gb': { type: 'glossary', rules: [] } };
        write(path.join(root, '.bindery', 'translations.json'), JSON.stringify(translations) + '\n');

        const result = toolAddDialect(root, { dialectCode: 'en-gb', from: 'x', to: 'y' });
        expect(result).toContain('Error');
        expect(result).toContain('glossary');
    });

    it('returns error for empty from or to', () => {
        const root = makeRoot();
        expect(toolAddDialect(root, { dialectCode: 'en-gb', from: '', to: 'colour' })).toContain('Error');
        expect(toolAddDialect(root, { dialectCode: 'en-gb', from: 'color', to: '' })).toContain('Error');
    });
});

// ─── toolGetDialect ───────────────────────────────────────────────────────────

describe('toolGetDialect', () => {
    it('lists all substitution rules', () => {
        const root = makeRoot();
        const translations = {
            'en-gb': { type: 'substitution', rules: [{ from: 'color', to: 'colour' }, { from: 'center', to: 'centre' }] },
        };
        write(path.join(root, '.bindery', 'translations.json'), JSON.stringify(translations) + '\n');

        const result = toolGetDialect(root, { dialectCode: 'en-gb' });
        expect(result).toContain('color');
        expect(result).toContain('colour');
        expect(result).toContain('center');
        expect(result).toContain('centre');
    });

    it('matches dialect key case-insensitively', () => {
        const root = makeRoot();
        const translations = {
            'en-gb': { type: 'substitution', rules: [{ from: 'color', to: 'colour' }] },
        };
        write(path.join(root, '.bindery', 'translations.json'), JSON.stringify(translations) + '\n');

        const result = toolGetDialect(root, { dialectCode: 'EN-GB' });
        expect(result).toContain('color');
    });

    it('performs word stem lookup', () => {
        const root = makeRoot();
        const translations = {
            'en-gb': { type: 'substitution', rules: [{ from: 'color', to: 'colour' }] },
        };
        write(path.join(root, '.bindery', 'translations.json'), JSON.stringify(translations) + '\n');

        // 'colors' → stems include 'color'
        const result = toolGetDialect(root, { dialectCode: 'en-gb', word: 'colors' });
        expect(result).toContain('color');
        expect(result).toContain('colour');
    });

    it('returns not-found message when word is absent', () => {
        const root = makeRoot();
        const translations = {
            'en-gb': { type: 'substitution', rules: [{ from: 'color', to: 'colour' }] },
        };
        write(path.join(root, '.bindery', 'translations.json'), JSON.stringify(translations) + '\n');

        const result = toolGetDialect(root, { dialectCode: 'en-gb', word: 'window' });
        expect(result).toContain('not found');
    });

    it('returns error when entry is glossary type', () => {
        const root = makeRoot();
        const translations = {
            nl: { type: 'glossary', rules: [{ from: 'cat', to: 'kat' }] },
        };
        write(path.join(root, '.bindery', 'translations.json'), JSON.stringify(translations) + '\n');

        const result = toolGetDialect(root, { dialectCode: 'nl' });
        expect(result).toContain('glossary');
        expect(result).toContain('get_translation');
    });

    it('returns error when translations.json is missing', () => {
        const root = makeRoot();
        const result = toolGetDialect(root, { dialectCode: 'en-gb' });
        expect(result).toContain('No translations.json found');
    });

    it('includes available dialects in the not-found error', () => {
        const root = makeRoot();
        const translations = {
            'en-gb': { type: 'substitution', rules: [] },
            'en-au': { type: 'substitution', rules: [] },
        };
        write(path.join(root, '.bindery', 'translations.json'), JSON.stringify(translations) + '\n');

        const result = toolGetDialect(root, { dialectCode: 'en-us' });
        expect(result).toContain('Available');
        expect(result).toContain('en-gb');
        expect(result).toContain('en-au');
    });
});
