/**
 * Obsidian Plugin — workspace management tests
 *
 * Tests settings/translations I/O and dialect/translation management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { readTranslations, upsertGlossaryRule, upsertSubstitutionRule } from '@bindery/core';
import { 
    readSettings, 
    writeSettings, 
    addDialectRule,
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

    describe('Language Management', () => {
        it('should add new language', () => {
            const settings = {
                bookTitle: 'Test',
                storyFolder: 'Story',
                languages: [{ code: 'EN', folderName: 'EN', chapterWord: 'Chapter', actPrefix: 'Act', prologueLabel: 'Prologue', epilogueLabel: 'Epilogue', isDefault: true }],
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
                    { code: 'EN', folderName: 'EN', chapterWord: 'Chapter', actPrefix: 'Act', prologueLabel: 'Prologue', epilogueLabel: 'Epilogue' },
                    { code: 'NL', folderName: 'NL', chapterWord: 'Hoofdstuk', actPrefix: 'Deel', prologueLabel: 'Proloog', epilogueLabel: 'Epiloog' },
                ],
            };
            writeSettings(tempRoot, settings);

            expect(() => addLanguage(tempRoot, 'NL', 'NL')).toThrow(/already exists/);
        });
    });

    describe('Dialect Rule Management', () => {
        it('should add dialect rule to translations.json via upsertSubstitutionRule', () => {
            // addDialectRule delegates to upsertSubstitutionRule for each dialect
            const settings = {
                bookTitle: 'Test',
                languages: [{
                    code: 'EN',
                    folderName: 'EN',
                    chapterWord: 'Chapter',
                    actPrefix: 'Act',
                    prologueLabel: 'Prologue',
                    epilogueLabel: 'Epilogue',
                    isDefault: true,
                    dialects: [{ code: 'en-gb', label: 'British English' }],
                }],
            };
            writeSettings(tempRoot, settings);

            addDialectRule(tempRoot, 'EN', 'color', 'colour');

            // Verify the rule was persisted in translations.json with the correct schema
            const translations = readTranslations(tempRoot);
            expect(translations).not.toBeNull();
            const entry = translations?.['en-gb'];
            expect(entry).toBeDefined();
            expect(entry?.type).toBe('substitution');
            const rule = entry?.rules?.find(r => r.from === 'color');
            expect(rule?.to).toBe('colour');
        });

        it('should throw when adding rule for non-existent language', () => {
            const settings = { languages: [] };
            writeSettings(tempRoot, settings);

            expect(() => addDialectRule(tempRoot, 'NONEXISTENT', 'foo', 'bar')).toThrow(/not found/);
        });

        it('should throw when language has no dialects configured', () => {
            const settings = {
                languages: [{
                    code: 'EN',
                    folderName: 'EN',
                    chapterWord: 'Chapter',
                    actPrefix: 'Act',
                    prologueLabel: 'Prologue',
                    epilogueLabel: 'Epilogue',
                }],
            };
            writeSettings(tempRoot, settings);

            expect(() => addDialectRule(tempRoot, 'EN', 'color', 'colour')).toThrow(/no dialects/);
        });

        it('should store rule lowercased for the from word', () => {
            const settings = {
                languages: [{
                    code: 'EN',
                    folderName: 'EN',
                    chapterWord: 'Chapter',
                    actPrefix: 'Act',
                    prologueLabel: 'Prologue',
                    epilogueLabel: 'Epilogue',
                    dialects: [{ code: 'en-gb' }],
                }],
            };
            writeSettings(tempRoot, settings);

            addDialectRule(tempRoot, 'EN', 'Color', 'colour');

            const translations = readTranslations(tempRoot);
            const rule = translations?.['en-gb']?.rules?.find(r => r.from === 'color');
            expect(rule).toBeDefined();
            expect(rule?.to).toBe('colour');
        });
    });

    describe('Translation Glossary (upsertGlossaryRule)', () => {
        it('should add a glossary entry via upsertGlossaryRule', () => {
            upsertGlossaryRule(tempRoot, 'nl', 'NL', 'EN', { from: 'castle', to: 'kasteel' });

            const translations = readTranslations(tempRoot);
            expect(translations).not.toBeNull();
            const entry = translations?.['nl'];
            expect(entry?.type).toBe('glossary');
            const rule = entry?.rules?.find(r => r.from === 'castle');
            expect(rule?.to).toBe('kasteel');
        });

        it('should update an existing glossary entry', () => {
            upsertGlossaryRule(tempRoot, 'nl', 'NL', 'EN', { from: 'castle', to: 'kasteel' });
            upsertGlossaryRule(tempRoot, 'nl', 'NL', 'EN', { from: 'castle', to: 'burcht' });

            const translations = readTranslations(tempRoot);
            const rules = translations?.['nl']?.rules ?? [];
            const matching = rules.filter(r => r.from === 'castle');
            expect(matching).toHaveLength(1);
            expect(matching[0].to).toBe('burcht');
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
