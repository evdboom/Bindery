/**
 * Bindery translation types and helpers.
 *
 * Manages .bindery/translations.json — substitution rules and glossaries
 * per language pair.
 *
 * Shared across vscode-ext, obsidian-plugin, and mcp-ts.
 * Zero dependency on VS Code or Obsidian APIs.
 */
/** Type of a translation entry — determines how the extension uses its rules. */
export type TranslationType = 'substitution' | 'glossary';
/** A single from→to rule inside a translation entry. */
export interface TranslationRule {
    from: string;
    to: string;
}
/**
 * One entry in translations.json, keyed by a language code (e.g. "en-gb", "nl").
 *
 * substitution — applied automatically during export (word-by-word replace).
 * glossary     — reference only; used for consistency checking, not auto-applied.
 */
export interface TranslationEntry {
    label?: string;
    type: TranslationType;
    sourceLanguage?: string;
    rules?: TranslationRule[];
    ignoredWords?: string[];
}
/** The full .bindery/translations.json file. */
export type TranslationsFile = Record<string, TranslationEntry>;
/** A US→UK word substitution pair. */
export interface UkReplacement {
    us: string;
    uk: string;
}
export declare function readTranslations(root: string): TranslationsFile | null;
export declare function writeTranslations(root: string, data: TranslationsFile): void;
/**
 * Get substitution rules from translations.json for the given language key.
 * Returns UkReplacement[] compatible with merge.ts (field names us/uk).
 * Only entries with type === 'substitution' are returned.
 */
export declare function getSubstitutionRules(translations: TranslationsFile | null, langKey: string): UkReplacement[];
/**
 * Get the ignored-words set for a given language key.
 */
export declare function getIgnoredWords(translations: TranslationsFile | null, langKey: string): Set<string>;
/**
 * Get glossary rules for a language key (type === 'glossary' entries only).
 */
export declare function getGlossaryRules(translations: TranslationsFile | null, langKey: string): TranslationRule[];
/**
 * Add or update a substitution rule in .bindery/translations.json.
 * Creates the file and entry if they do not yet exist.
 */
export declare function upsertSubstitutionRule(root: string, langKey: string, rule: TranslationRule): void;
/**
 * Add words to the ignoredWords list in .bindery/translations.json.
 * Returns the count of newly added words (duplicates are skipped).
 */
export declare function addIgnoredWords(root: string, langKey: string, words: string[]): number;
/**
 * Add or update a glossary rule in .bindery/translations.json.
 * Glossary entries are for cross-language reference (e.g. EN→NL world terms).
 * They are not auto-applied at export; agents use them for consistency checking.
 * Creates the file and entry if they do not yet exist.
 */
export declare function upsertGlossaryRule(root: string, langKey: string, langLabel: string, sourceLang: string, rule: TranslationRule): void;
