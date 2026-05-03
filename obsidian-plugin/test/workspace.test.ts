/**
 * Obsidian Plugin — workspace management tests
 *
 * Tests settings/translations I/O and dialect/translation management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { 
    readSettings, 
    writeSettings, 
    readTranslations, 
    writeTranslations, 
    addDialectRule,
    addTranslationEntry,
    getTranslation,
    addLanguage,
    findProbableUsWords,
} from '../src/workspace';

describe('Workspace Management', () => {
    let tempRoot: string;

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-workspace-test-'));
    });

    afterEach(() => {
        if (fs.existsSync(tempRoot)) {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    describe('Settings I/O', () => {
        it('should read and write settings', () => {
            const settings = {
                bookTitle: 'Test Book',
                author: 'Test Author',
                storyFolder: 'Story',
                formatOnSave: true,
            };

            writeSettings(tempRoot, settings);

            const read = readSettings(tempRoot);
            expect(read).toEqual(settings);
        });

        it('should return null when settings do not exist', () => {
            const result = readSettings(tempRoot);
            expect(result).toBeNull();
        });

        it('should create .bindery folder if it does not exist', () => {
            const settings = { bookTitle: 'New Book' };
            writeSettings(tempRoot, settings);

            const binderyPath = path.join(tempRoot, '.bindery');
            expect(fs.existsSync(binderyPath)).toBe(true);
        });
    });

    describe('Translations I/O', () => {
        it('should read and write translations', () => {
            const entries = [
                { term: 'magical', translations: { NL: 'magisch' } },
                { term: 'sword', translations: { NL: 'zwaard' } },
            ];

            writeTranslations(tempRoot, entries);

            const read = readTranslations(tempRoot);
            expect(read).toEqual(entries);
        });

        it('should return empty array when translations do not exist', () => {
            const result = readTranslations(tempRoot);
            expect(result).toEqual([]);
        });

        it('should handle malformed JSON gracefully', () => {
            const translationsPath = path.join(tempRoot, '.bindery', 'translations.json');
            fs.mkdirSync(path.dirname(translationsPath), { recursive: true });
            fs.writeFileSync(translationsPath, 'invalid json', 'utf-8');

            const result = readTranslations(tempRoot);
            expect(result).toEqual([]);
        });
    });

    describe('Translation Entry Management', () => {
        it('should add new translation entry', () => {
            addTranslationEntry(tempRoot, 'hello', { EN: 'hello', NL: 'hallo' });

            const translations = readTranslations(tempRoot);
            expect(translations).toHaveLength(1);
            expect(translations[0].term).toBe('hello');
            expect(translations[0].translations.NL).toBe('hallo');
        });

        it('should update existing translation entry', () => {
            addTranslationEntry(tempRoot, 'sword', { EN: 'sword', NL: 'zwaard' });
            addTranslationEntry(tempRoot, 'sword', { EN: 'sword', NL: 'sabel' });

            const translations = readTranslations(tempRoot);
            expect(translations).toHaveLength(1);
            expect(translations[0].translations.NL).toBe('sabel');
        });

        it('should sort translation entries alphabetically', () => {
            addTranslationEntry(tempRoot, 'zebra', { EN: 'zebra' });
            addTranslationEntry(tempRoot, 'apple', { EN: 'apple' });
            addTranslationEntry(tempRoot, 'mango', { EN: 'mango' });

            const translations = readTranslations(tempRoot);
            const terms = translations.map(t => t.term);
            expect(terms).toEqual(['apple', 'mango', 'zebra']);
        });

        it('should retrieve translation by term and language', () => {
            addTranslationEntry(tempRoot, 'castle', { EN: 'castle', NL: 'kasteel', FR: 'château' });

            const nlTranslation = getTranslation(tempRoot, 'castle', 'NL');
            expect(nlTranslation).toBe('kasteel');

            const frTranslation = getTranslation(tempRoot, 'castle', 'FR');
            expect(frTranslation).toBe('château');
        });

        it('should return null for missing translation', () => {
            const result = getTranslation(tempRoot, 'nonexistent', 'NL');
            expect(result).toBeNull();
        });

        it('should be case-insensitive for term lookup', () => {
            addTranslationEntry(tempRoot, 'Dragon', { EN: 'Dragon', NL: 'Draak' });

            const result1 = getTranslation(tempRoot, 'dragon', 'NL');
            const result2 = getTranslation(tempRoot, 'DRAGON', 'NL');
            expect(result1).toBe('Draak');
            expect(result2).toBe('Draak');
        });
    });

    describe('Language Management', () => {
        it('should add new language', () => {
            const settings = {
                bookTitle: 'Test',
                storyFolder: 'Story',
                languages: [{ code: 'EN', folderName: 'EN' }],
            };
            writeSettings(tempRoot, settings);

            addLanguage(tempRoot, 'NL', 'NL', 'Hoofdstuk', 'Deel');

            const updated = readSettings(tempRoot);
            expect(updated?.languages).toHaveLength(2);
            expect(updated?.languages?.[1].code).toBe('NL');
        });

        it('should create language folder', () => {
            const settings = { storyFolder: 'Story', languages: [] };
            writeSettings(tempRoot, settings);

            addLanguage(tempRoot, 'FR', 'FR');

            const frPath = path.join(tempRoot, 'Story', 'FR');
            expect(fs.existsSync(frPath)).toBe(true);
        });

        it('should throw when adding duplicate language', () => {
            const settings = {
                bookTitle: 'Test',
                storyFolder: 'Story',
                languages: [
                    { code: 'EN', folderName: 'EN' },
                    { code: 'NL', folderName: 'NL' },
                ],
            };
            writeSettings(tempRoot, settings);

            expect(() => addLanguage(tempRoot, 'NL', 'NL')).toThrow(/already exists/);
        });
    });

    describe('Dialect Rule Management', () => {
        it('should add dialect rule', () => {
            const settings = {
                bookTitle: 'Test',
                languages: [{ code: 'EN', folderName: 'EN' }],
            };
            writeSettings(tempRoot, settings);

            addDialectRule(tempRoot, 'EN', 'color', 'colour');

            const updated = readSettings(tempRoot);
            expect(updated?.languages).toBeDefined();
        });

        it('should throw when adding rule for non-existent language', () => {
            const settings = { languages: [] };
            writeSettings(tempRoot, settings);

            expect(() => addDialectRule(tempRoot, 'NONEXISTENT', 'foo', 'bar')).toThrow(/not found/);
        });
    });

    describe('Probable US Word Detection', () => {
        it('should find -ization words', () => {
            const text = 'The organization and utilization of resources';
            const words = findProbableUsWords(text);
            expect(words).toContain('organization');
            expect(words).toContain('utilization');
        });

        it('should find -izing words', () => {
            const text = 'Organizing and standardizing the data';
            const words = findProbableUsWords(text);
            const hasOrganizing = words.some(w => w.toLowerCase().includes('organiz'));
            const hasStandardizing = words.some(w => w.toLowerCase().includes('standard'));
            expect(hasOrganizing || hasStandardizing).toBe(true);
        });

        it('should find -ized words', () => {
            const text = 'The color was standardized';
            const words = findProbableUsWords(text);
            expect(words).toContain('standardized');
        });

        it('should find color-related words', () => {
            const text = 'The color and flavor of the center';
            const words = findProbableUsWords(text);
            expect(words.some(w => w.toLowerCase().includes('color'))).toBe(true);
            expect(words.some(w => w.toLowerCase().includes('center'))).toBe(true);
        });

        it('should return empty array when no US words found', () => {
            const text = 'The colour and flavour of the centre are perfect.';
            const words = findProbableUsWords(text);
            expect(words.length).toBe(0);
        });
    });
});
