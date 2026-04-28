/**
 * Unit tests for bindery-core/src/settings.ts
 *
 * Tests path helpers, readers, and accessors.
 * Mirror of vscode-ext/test/workspace-extended.test.ts (settings subset).
 */

import * as fs   from 'node:fs';
import * as os   from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    getBinderyFolder,
    getBookTitleForLang,
    getDefaultLanguage,
    getDialectsForLanguage,
    getSettingsPath,
    getTranslationsPath,
    readWorkspaceSettings,
    type WorkspaceSettings,
} from '../src/settings';

const tempRoots: string[] = [];

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-core-settings-test-'));
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

// ─── Path helpers ─────────────────────────────────────────────────────────────

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

// ─── readWorkspaceSettings ────────────────────────────────────────────────────

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
                ],
            })
        );
        const settings = readWorkspaceSettings(root);
        expect(settings!.languages).toHaveLength(2);
    });
});

// ─── getBookTitleForLang ──────────────────────────────────────────────────────

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
        const settings: WorkspaceSettings = { bookTitle: { en: 'Road', nl: 'Weg', fr: 'Route' } };
        expect(getBookTitleForLang(settings, 'nl')).toBe('Weg');
        expect(getBookTitleForLang(settings, 'fr')).toBe('Route');
    });

    it('falls back to en when specific language is not found', () => {
        const settings: WorkspaceSettings = { bookTitle: { en: 'Road' } };
        expect(getBookTitleForLang(settings, 'de')).toBe('Road');
    });

    it('returns undefined when map has no matching language and no en', () => {
        const settings: WorkspaceSettings = { bookTitle: { fr: 'Route' } };
        expect(getBookTitleForLang(settings, 'de')).toBeUndefined();
    });

    it('is case-insensitive for language codes', () => {
        const settings: WorkspaceSettings = { bookTitle: { en: 'Road', nl: 'Weg' } };
        expect(getBookTitleForLang(settings, 'NL')).toBe('Weg');
    });
});

// ─── getDefaultLanguage ───────────────────────────────────────────────────────

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

// ─── getDialectsForLanguage ───────────────────────────────────────────────────

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
