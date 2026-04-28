/**
 * Bindery workspace settings types and helpers.
 *
 * Shared across vscode-ext, obsidian-plugin, and mcp-ts.
 * Zero dependency on VS Code or Obsidian APIs.
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';

// ─── Language / Dialect Types ──────────────────────────────────────────────

export interface LanguageConfig {
    code: string;
    folderName: string;
    /** Optional per-language export title from settings.json languages[]. */
    bookTitle?: string;
    chapterWord: string;
    actPrefix: string;
    prologueLabel: string;
    epilogueLabel: string;
    /** True for the primary language the book is written in. */
    isDefault?: boolean;
    /** Dialect exports derived from this language (e.g. en-gb from EN). No story folder of their own. */
    dialects?: DialectConfig[];
}

/** A dialect derived from a parent language — same story folder, word substitutions applied at export. */
export interface DialectConfig {
    /** Dialect code, used as the key in translations.json (e.g. 'en-gb'). */
    code: string;
    /** Human-readable label, e.g. 'British English'. */
    label?: string;
}

// ─── Settings Schema ──────────────────────────────────────────────────────

/**
 * .bindery/settings.json
 *
 * bookTitle may be a plain string or a per-language map:
 *   "bookTitle": "The Hollow Road"
 *   "bookTitle": { "en": "The Hollow Road", "nl": "De Holle Weg" }
 */
export interface WorkspaceSettings {
    bookTitle?:      string | Record<string, string>;
    author?:         string;
    /** Short description or tagline used when generating AI assistant files. */
    description?:    string;
    /** Genre of the book (e.g. "sci-fi/fantasy", "mystery", "contemporary fiction"). */
    genre?:          string;
    /** Target audience, e.g. "12+" or "adults" or "8-10". Used to calibrate AI review feedback. */
    targetAudience?: string;
    /** AI targets previously chosen when running Set Up AI Files (claude, copilot, cursor, agents). */
    aiTargets?: string[];
    /** Claude skills previously chosen when running Set Up AI Files. */
    aiSkills?: string[];
    storyFolder?:     string;
    mergedOutputDir?:  string;
    mergeFilePrefix?: string;
    formatOnSave?:   boolean;
    languages?:      LanguageConfig[];
    git?: {
        snapshot?: {
            pushDefault?: boolean;
            remote?: string;
            branch?: string;
        };
    };
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const BINDERY_FOLDER        = '.bindery';
export const SETTINGS_FILENAME     = 'settings.json';
export const TRANSLATIONS_FILENAME = 'translations.json';

// ─── Path helpers ─────────────────────────────────────────────────────────────

export function getBinderyFolder(root: string): string {
    return path.join(root, BINDERY_FOLDER);
}

export function getSettingsPath(root: string): string {
    return path.join(root, BINDERY_FOLDER, SETTINGS_FILENAME);
}

export function getTranslationsPath(root: string): string {
    return path.join(root, BINDERY_FOLDER, TRANSLATIONS_FILENAME);
}

// ─── Readers ─────────────────────────────────────────────────────────────────

export function readWorkspaceSettings(root: string): WorkspaceSettings | null {
    const p = getSettingsPath(root);
    if (!fs.existsSync(p)) { return null; }
    try {
        return JSON.parse(fs.readFileSync(p, 'utf-8')) as WorkspaceSettings;
    } catch {
        return null;
    }
}

// ─── Accessors ────────────────────────────────────────────────────────────────

/**
 * Resolve the book title for a given language code.
 * Falls back to the English title if no language-specific title is found.
 */
export function getBookTitleForLang(
    settings: WorkspaceSettings | null,
    langCode:  string
): string | undefined {
    if (!settings?.bookTitle) { return undefined; }
    if (typeof settings.bookTitle === 'string') {
        return settings.bookTitle || undefined;
    }
    const code = langCode.toLowerCase();
    return settings.bookTitle[code]
        ?? settings.bookTitle['en']
        ?? undefined;
}

/**
 * Return the language marked isDefault, or the first language in the list.
 */
export function getDefaultLanguage(
    settings: WorkspaceSettings | null
): LanguageConfig | undefined {
    const langs = settings?.languages;
    if (!langs || langs.length === 0) { return undefined; }
    return langs.find(l => l.isDefault) ?? langs[0];
}

/**
 * Return dialects[] for the language matching langCode, or [].
 */
export function getDialectsForLanguage(
    settings: WorkspaceSettings | null,
    langCode: string
): DialectConfig[] {
    const lang = settings?.languages?.find(
        l => l.code.toUpperCase() === langCode.toUpperCase()
    );
    return lang?.dialects ?? [];
}
