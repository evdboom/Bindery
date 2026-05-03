/**
 * Obsidian-specific workspace management.
 *
 * Handles reading/writing .bindery/settings.json and translations.json,
 * dialect management, and translation glossary entries.
 * Mirrors functionality from vscode-ext/src/workspace.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    BINDERY_FOLDER,
    SETTINGS_FILENAME,
    type WorkspaceSettings,
    type LanguageConfig,
    upsertSubstitutionRule,
} from '@bindery/core';

export type { WorkspaceSettings, LanguageConfig };

/**
 * Read workspace settings from .bindery/settings.json
 */
export function readSettings(bookRoot: string): WorkspaceSettings | null {
    const settingsPath = path.join(bookRoot, BINDERY_FOLDER, SETTINGS_FILENAME);
    if (!fs.existsSync(settingsPath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as WorkspaceSettings;
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
 * Add or update a dialect rule (US ↔ UK spelling, etc.) in .bindery/translations.json.
 * The rule is stored under each dialect code configured for the given language.
 */
export function addDialectRule(bookRoot: string, language: string, from: string, to: string): void {
    const settings = readSettings(bookRoot);
    const languages = settings?.languages ?? [];

    const lang = languages.find(l => l.code.toUpperCase() === language.toUpperCase());
    if (!lang) {
        throw new Error(`Language "${language}" not found in settings`);
    }

    const dialects = lang.dialects ?? [];
    if (dialects.length === 0) {
        throw new Error(
            `Language "${language}" has no dialects configured in settings.json. ` +
            `Add a dialects[] entry to this language.`
        );
    }

    for (const dialect of dialects) {
        upsertSubstitutionRule(bookRoot, dialect.code, { from: from.toLowerCase(), to });
    }
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
        prologueLabel: 'Prologue',
        epilogueLabel: 'Epilogue',
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
