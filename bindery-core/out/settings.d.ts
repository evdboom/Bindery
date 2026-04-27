/**
 * Bindery workspace settings types and helpers.
 *
 * Shared across vscode-ext, obsidian-plugin, and mcp-ts.
 * Zero dependency on VS Code or Obsidian APIs.
 */
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
/**
 * .bindery/settings.json
 *
 * bookTitle may be a plain string or a per-language map:
 *   "bookTitle": "The Hollow Road"
 *   "bookTitle": { "en": "The Hollow Road", "nl": "De Holle Weg" }
 */
export interface WorkspaceSettings {
    bookTitle?: string | Record<string, string>;
    author?: string;
    /** Short description or tagline used when generating AI assistant files. */
    description?: string;
    /** Genre of the book (e.g. "sci-fi/fantasy", "mystery", "contemporary fiction"). */
    genre?: string;
    /** Target audience, e.g. "12+" or "adults" or "8-10". Used to calibrate AI review feedback. */
    targetAudience?: string;
    /** AI targets previously chosen when running Set Up AI Files (claude, copilot, cursor, agents). */
    aiTargets?: string[];
    /** Claude skills previously chosen when running Set Up AI Files. */
    aiSkills?: string[];
    storyFolder?: string;
    mergedOutputDir?: string;
    mergeFilePrefix?: string;
    formatOnSave?: boolean;
    languages?: LanguageConfig[];
    git?: {
        snapshot?: {
            pushDefault?: boolean;
            remote?: string;
            branch?: string;
        };
    };
}
export declare const BINDERY_FOLDER = ".bindery";
export declare const SETTINGS_FILENAME = "settings.json";
export declare const TRANSLATIONS_FILENAME = "translations.json";
export declare function getBinderyFolder(root: string): string;
export declare function getSettingsPath(root: string): string;
export declare function getTranslationsPath(root: string): string;
export declare function readWorkspaceSettings(root: string): WorkspaceSettings | null;
/**
 * Resolve the book title for a given language code.
 * Falls back to the English title if no language-specific title is found.
 */
export declare function getBookTitleForLang(settings: WorkspaceSettings | null, langCode: string): string | undefined;
/**
 * Return the language marked isDefault, or the first language in the list.
 */
export declare function getDefaultLanguage(settings: WorkspaceSettings | null): LanguageConfig | undefined;
/**
 * Return dialects[] for the language matching langCode, or [].
 */
export declare function getDialectsForLanguage(settings: WorkspaceSettings | null, langCode: string): DialectConfig[];
