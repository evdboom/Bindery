/**
 * Bindery translation types and helpers.
 *
 * Manages .bindery/translations.json — substitution rules and glossaries
 * per language pair.
 *
 * Shared across vscode-ext, obsidian-plugin, and mcp-ts.
 * Zero dependency on VS Code or Obsidian APIs.
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';
import { getTranslationsPath } from './settings';

// ─── Types ───────────────────────────────────────────────────────────────────

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

/** A US→UK word substitution pair. */
export interface UkReplacement {
    us: string;
    uk: string;
}

// ─── Readers ─────────────────────────────────────────────────────────────────

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
    if (entry?.type !== 'substitution') { return []; }
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

/**
 * Get glossary rules for a language key (type === 'glossary' entries).
 */
export function getGlossaryRules(
    translations: TranslationsFile | null,
    langKey:      string
): TranslationRule[] {
    if (!translations) { return []; }
    const entry = resolveEntry(translations, langKey);
    if (!entry) { return []; }
    return (entry.rules ?? []).filter(r => r.from?.trim() && r.to?.trim());
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
    entry.ignoredWords = Array.from(existing).sort((a, b) => a.localeCompare(b));
    writeTranslations(root, translations);
    return added;
}

/**
 * Add or update a glossary rule in .bindery/translations.json.
 * Glossary entries are for cross-language reference (e.g. EN→NL world terms).
 * They are not auto-applied at export; agents use them for consistency checking.
 * Creates the file and entry if they do not yet exist.
 */
export function upsertGlossaryRule(
    root:       string,
    langKey:    string,
    langLabel:  string,
    sourceLang: string,
    rule:       TranslationRule
): void {
    const translations = readTranslations(root) ?? {};
    if (!translations[langKey]) {
        translations[langKey] = {
            label:          langLabel,
            type:           'glossary',
            sourceLanguage: sourceLang,
            rules:          [],
        };
    }
    const entry = translations[langKey];
    // If entry exists but was previously substitution, keep it — don't downgrade
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
