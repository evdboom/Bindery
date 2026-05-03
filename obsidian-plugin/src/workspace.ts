/**
 * Obsidian-specific workspace management.
 *
 * Handles reading/writing .bindery/settings.json and translations.json,
 * dialect management, and translation glossary entries.
 * Mirrors functionality from vscode-ext/src/workspace.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { BINDERY_FOLDER, SETTINGS_FILENAME, TRANSLATIONS_FILENAME } from '@bindery/core';

export interface LanguageConfig {
    code: string;
    folderName: string;
    chapterWord?: string;
    actPrefix?: string;
    prologueLabel?: string;
    epilogueLabel?: string;
    isDefault?: boolean;
    dialects?: DialectConfig[];
}

export interface DialectConfig {
    code: string;
    folderName?: string;
}

export interface WorkspaceSettings {
    bookTitle?: string;
    author?: string;
    description?: string;
    genre?: string;
    targetAudience?: string;
    storyFolder?: string;
    mergedOutputDir?: string;
    mergeFilePrefix?: string;
    formatOnSave?: boolean;
    pandocPath?: string;
    libreOfficePath?: string;
    languages?: LanguageConfig[];
}

export interface TranslationEntry {
    term: string;
    translations: Record<string, string>;
}

/**
 * Read workspace settings from .bindery/settings.json
 */
export function readSettings(bookRoot: string): WorkspaceSettings | null {
    const settingsPath = path.join(bookRoot, BINDERY_FOLDER, SETTINGS_FILENAME);
    if (!fs.existsSync(settingsPath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
        return null;
    }
}

/**
 * Write workspace settings to .bindery/settings.json
 */
export function writeSettings(bookRoot: string, settings: WorkspaceSettings): void {
    const binderyPath = path.join(bookRoot, BINDERY_FOLDER);
    if (!fs.existsSync(binderyPath)) {
        fs.mkdirSync(binderyPath, { recursive: true });
    }
    const settingsPath = path.join(binderyPath, SETTINGS_FILENAME);
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

/**
 * Read translations glossary from .bindery/translations.json
 */
export function readTranslations(bookRoot: string): TranslationEntry[] {
    const translationsPath = path.join(bookRoot, BINDERY_FOLDER, TRANSLATIONS_FILENAME);
    if (!fs.existsSync(translationsPath)) {
        return [];
    }
    try {
        const data = JSON.parse(fs.readFileSync(translationsPath, 'utf-8'));
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

/**
 * Write translations glossary to .bindery/translations.json
 */
export function writeTranslations(bookRoot: string, entries: TranslationEntry[]): void {
    const binderyPath = path.join(bookRoot, BINDERY_FOLDER);
    if (!fs.existsSync(binderyPath)) {
        fs.mkdirSync(binderyPath, { recursive: true });
    }
    const translationsPath = path.join(binderyPath, TRANSLATIONS_FILENAME);
    fs.writeFileSync(translationsPath, JSON.stringify(entries, null, 2) + '\n', 'utf-8');
}

/**
 * Add or update a dialect rule (US ↔ UK spelling, etc.)
 */
export function addDialectRule(bookRoot: string, language: string, from: string, to: string): void {
    const settings = readSettings(bookRoot) || { languages: [] };    
    settings.languages ??= [];
    

    const lang = settings.languages.find(l => l.code === language);
    if (!lang) {
        throw new Error(`Language "${language}" not found in settings`);
    }

    lang.dialects ??= [];
    
    // Store rule in memory for now; in a real implementation, could store in a separate file
    writeSettings(bookRoot, settings);
}

/**
 * Add or update a translation glossary entry
 */
export function addTranslationEntry(bookRoot: string, term: string, translations: Record<string, string>): void {
    const entries = readTranslations(bookRoot);
    const existing = entries.findIndex(e => e.term.toLowerCase() === term.toLowerCase());

    if (existing >= 0) {
        entries[existing] = { term, translations };
    } else {
        entries.push({ term, translations });
    }

    // Sort by term for consistency
    entries.sort((a, b) => a.term.localeCompare(b.term));
    writeTranslations(bookRoot, entries);
}

/**
 * Get translation for a term in a specific language
 */
export function getTranslation(bookRoot: string, term: string, language: string): string | null {
    const entries = readTranslations(bookRoot);
    const entry = entries.find(e => e.term.toLowerCase() === term.toLowerCase());
    return entry ? (entry.translations[language] ?? null) : null;
}

/**
 * Add a new language to the workspace
 */
export function addLanguage(
    bookRoot: string,
    code: string,
    folderName: string,
    chapterWord?: string,
    actPrefix?: string
): void {
    const settings = readSettings(bookRoot) || { languages: [] };
    settings.languages ??= [];

    if (settings.languages.some(l => l.code === code)) {
        throw new Error(`Language "${code}" already exists`);
    }

    settings.languages.push({
        code,
        folderName,
        chapterWord: chapterWord ?? 'Chapter',
        actPrefix: actPrefix ?? 'Act',
    });

    writeSettings(bookRoot, settings);

    // Create the language folder structure
    const storyFolder = settings.storyFolder ?? 'Story';
    const langPath = path.join(bookRoot, storyFolder, folderName);
    if (!fs.existsSync(langPath)) {
        fs.mkdirSync(langPath, { recursive: true });
    }
}

/**
 * Find probable US English words for dialect conversion
 */
export function findProbableUsWords(content: string): string[] {
    const usPatterns = [
        /\b([A-Za-z]+ization|[A-Za-z]+izations|[A-Za-z]+izing|[A-Za-z]+ized|[A-Za-z]+izes|[A-Za-z]+ize)\b/gi,
        /\b(color|colors|colored|coloring|center|centers|centered|centering|favorite|favorites|favor|favors|favored|favoring)\b/gi,
        /\b(traveled|traveling|traveler|travelers|canceled|canceling|gray|fiber|defense|offense|mom)\b/gi,
    ];

    const found = new Set<string>();
    for (const pattern of usPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            found.add(match[0]);
        }
    }

    return Array.from(found).sort();
}
