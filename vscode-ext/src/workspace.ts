/**
 * Bindery — workspace settings reader
 *
 * Reads .bindery/settings.json  → project config (title, author, story folder, languages…)
 * Reads .bindery/translations.json → substitution rules and glossaries per language pair
 *
 * Priority for all settings: workspace file → VS Code settings → code defaults.
 * Machine-specific paths (pandoc, LibreOffice) always come from VS Code settings.
 */

import * as fs   from 'fs';
import * as path from 'path';
import type { LanguageConfig, UkReplacement } from './merge';

export const BINDERY_FOLDER       = '.bindery';
export const SETTINGS_FILENAME    = 'settings.json';
export const TRANSLATIONS_FILENAME = 'translations.json';

// ─── Types ───────────────────────────────────────────────────────────────────

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
    storyFolder?:    string;
    mergedOutputDir?: string;
    mergeFilePrefix?: string;
    formatOnSave?:   boolean;
    languages?:      LanguageConfig[];
}

/** Type of a translation entry — determines how the extension uses its rules. */
export type TranslationType = 'substitution' | 'glossary';

/** A single from→to rule inside a translation entry. */
export interface TranslationRule {
    from: string;
    to:   string;
}

/**
 * One entry in translations.json, keyed by a language code (e.g. "en-gb", "nl").
 *
 * substitution — applied automatically during export (word-by-word replace).
 * glossary     — reference only; used for consistency checking, not auto-applied.
 */
export interface TranslationEntry {
    label?:          string;
    type:            TranslationType;
    sourceLanguage?: string;
    rules?:          TranslationRule[];
    ignoredWords?:   string[];
}

/** The full .bindery/translations.json file. */
export type TranslationsFile = Record<string, TranslationEntry>;

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

export function readTranslations(root: string): TranslationsFile | null {
    const p = getTranslationsPath(root);
    if (!fs.existsSync(p)) { return null; }
    try {
        return JSON.parse(fs.readFileSync(p, 'utf-8')) as TranslationsFile;
    } catch {
        return null;
    }
}

// ─── Writers ─────────────────────────────────────────────────────────────────

export function writeTranslations(root: string, data: TranslationsFile): void {
    const p = getTranslationsPath(root);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf-8');
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
 * Get substitution rules from translations.json for the given language key.
 * Returns UkReplacement[] compatible with merge.ts (field names us/uk).
 * Only entries with type === 'substitution' are returned.
 */
export function getSubstitutionRules(
    translations: TranslationsFile | null,
    langKey:      string
): UkReplacement[] {
    if (!translations) { return []; }
    const entry = resolveEntry(translations, langKey);
    if (!entry || entry.type !== 'substitution') { return []; }
    return (entry.rules ?? [])
        .filter(r => r.from?.trim() && r.to?.trim())
        .map(r => ({ us: r.from.trim().toLowerCase(), uk: r.to.trim() }));
}

/**
 * Get the ignored-words set for a given language key.
 */
export function getIgnoredWords(
    translations: TranslationsFile | null,
    langKey:      string
): Set<string> {
    if (!translations) { return new Set(); }
    const entry = resolveEntry(translations, langKey);
    const result = new Set<string>();
    for (const word of entry?.ignoredWords ?? []) {
        const w = word.trim().toLowerCase();
        if (w) { result.add(w); }
    }
    return result;
}

// ─── Mutators ─────────────────────────────────────────────────────────────────

/**
 * Add or update a substitution rule in .bindery/translations.json.
 * Creates the file and entry if they do not yet exist.
 */
export function upsertSubstitutionRule(
    root:    string,
    langKey: string,
    rule:    TranslationRule
): void {
    const translations = readTranslations(root) ?? {};
    if (!translations[langKey]) {
        translations[langKey] = {
            type:           'substitution',
            sourceLanguage: 'en',
            rules:          [],
            ignoredWords:   [],
        };
    }
    const entry = translations[langKey];
    if (entry.type !== 'substitution') {
        throw new Error(`Entry '${langKey}' has type '${entry.type}', expected 'substitution'.`);
    }
    const rules = entry.rules ?? [];
    const idx = rules.findIndex(r => r.from.toLowerCase() === rule.from.toLowerCase());
    if (idx >= 0) {
        rules[idx] = rule;
    } else {
        rules.push(rule);
        rules.sort((a, b) => a.from.localeCompare(b.from));
    }
    entry.rules = rules;
    writeTranslations(root, translations);
}

/**
 * Add words to the ignoredWords list in .bindery/translations.json.
 * Returns the count of newly added words (duplicates are skipped).
 */
export function addIgnoredWords(
    root:    string,
    langKey: string,
    words:   string[]
): number {
    const translations = readTranslations(root) ?? {};
    if (!translations[langKey]) {
        translations[langKey] = {
            type:           'substitution',
            sourceLanguage: 'en',
            rules:          [],
            ignoredWords:   [],
        };
    }
    const entry   = translations[langKey];
    const existing = new Set((entry.ignoredWords ?? []).map(w => w.toLowerCase()));
    let added = 0;
    for (const word of words) {
        const w = word.trim().toLowerCase();
        if (w && !existing.has(w)) {
            existing.add(w);
            added++;
        }
    }
    entry.ignoredWords = Array.from(existing).sort();
    writeTranslations(root, translations);
    return added;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function normaliseKey(key: string): string {
    return key.trim().toLowerCase();
}

function isUkLike(key: string): boolean {
    const k = normaliseKey(key);
    return k === 'uk' || k === 'en-gb' || k === 'en-uk';
}

/**
 * Look up a translation entry by language key.
 * Falls back to 'en-gb' for UK-like codes.
 */
function resolveEntry(
    translations: TranslationsFile,
    langKey:      string
): TranslationEntry | undefined {
    const target = normaliseKey(langKey);
    for (const [k, v] of Object.entries(translations)) {
        if (normaliseKey(k) === target) { return v; }
    }
    // For UK-like codes, also accept an 'en-gb' entry
    if (isUkLike(target)) {
        for (const [k, v] of Object.entries(translations)) {
            if (normaliseKey(k) === 'en-gb') { return v; }
        }
    }
    return undefined;
}
