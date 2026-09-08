/**
 * Translation, dialect, and language MCP tool implementations.
 *
 * Extracted from tools.ts (Packet 3). These tools read/write
 * `.bindery/translations.json` and the `languages` array in
 * `.bindery/settings.json`. Re-exported from tools.ts so existing
 * `./tools.js` consumers are unchanged.
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';
import {
    normalizeFolderName,
    resolveWorkspacePath,
    validateWorkspaceSettingsPaths,
} from './tools-path.js';
import { TranslationsFile } from '@bindery/core';

// ─── Domain-local types ───────────────────────────────────────────────────────

interface LanguageEntry { code: string; folderName: string; chapterWord: string; actPrefix: string; prologueLabel: string; epilogueLabel: string; isDefault?: boolean }

/** Generate stem variants for forgiving word lookup. */
function wordStems(word: string): string[] {
    const variants = new Set<string>([word]);
    // strip common suffixes to reach a base form
    if (word.endsWith('ies'))   { variants.add(word.slice(0, -3) + 'y'); }
    if (word.endsWith('es'))    { variants.add(word.slice(0, -2)); }
    if (word.endsWith('s'))     { variants.add(word.slice(0, -1)); }
    if (word.endsWith('ed'))    { variants.add(word.slice(0, -2)); variants.add(word.slice(0, -1)); }
    if (word.endsWith('ing'))   { variants.add(word.slice(0, -3)); variants.add(word.slice(0, -3) + 'e'); }
    // also try adding -s so a bare stem matches plurals stored in the file
    variants.add(word + 's');
    return Array.from(variants);
}

// ─── get_translation ─────────────────────────────────────────────────────────

export interface GetTranslationArgs {
    language: string;
    word?:    string;
    /** Filter by entry type. Default: 'glossary' (cross-language reference). */
    type?:    'glossary' | 'substitution';
}

export function toolGetTranslation(root: string, args: GetTranslationArgs): string {
    const filePath = path.join(root, '.bindery', 'translations.json');
    if (!fs.existsSync(filePath)) {
        return 'No translations.json found. Run "init_workspace" or "add_translation" first.';
    }

    let translations: TranslationsFile;
    try { translations = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TranslationsFile; }
    catch { return 'Error: failed to parse .bindery/translations.json'; }

    const entryType = args.type ?? 'glossary';
    const langLower = args.language.toLowerCase();

    // Resolve key — case-insensitive, accept code or label
    const matchedKey = Object.keys(translations).find(
        k => k.toLowerCase() === langLower ||
             translations[k].label?.toLowerCase() === langLower ||
             translations[k].sourceLanguage?.toLowerCase() === langLower
    );

    if (!matchedKey) {
        const available = Object.entries(translations)
            .filter(([, e]) => e.type === entryType || args.type === undefined)
            .map(([k, e]) => k + (e.label ? ` (${e.label})` : ''))
            .join(', ');
        return `No translation entry found for "${args.language}". Available: ${available || 'none'}`;
    }

    const entry = translations[matchedKey];
    if (entry.type !== entryType) {
        return `Entry "${matchedKey}" is type "${entry.type}", not "${entryType}". Use get_dialect for substitution rules.`;
    }

    const rules = entry.rules ?? [];
    if (!args.word) {
        if (rules.length === 0) { return `No rules defined for "${matchedKey}" yet.`; }
        const labelPart = entry.label ? ` — ${entry.label}` : '';
        const header = `${matchedKey}${labelPart} (${entry.type}, ${rules.length} rules):`;
        return [header, ...rules.map(r => `  ${r.from}  →  ${r.to}`)].join('\n');
    }

    const stems = wordStems(args.word.toLowerCase());
    const matches = rules.filter(r => stems.includes(r.from.toLowerCase()));
    if (matches.length === 0) { return `"${args.word}" not found in ${matchedKey} translations.`; }
    return matches.map(r => `${r.from}  →  ${r.to}  [${matchedKey}]`).join('\n');
}

// ─── add_translation ──────────────────────────────────────────────────────────

export interface AddTranslationArgs {
    /** Target language code (e.g. 'nl', 'fr'). Used as key in translations.json. */
    targetLangCode: string;
    from:           string;
    to:             string;
}

// ─── Built-in en-gb substitution rules (US → British English) ────────────────
// Seeded by tools.ts via seedTranslations() using BUILTIN_EN_GB_RULES from ./tools-dialect-defaults.ts.

export function toolAddTranslation(root: string, args: AddTranslationArgs): string {
    const { targetLangCode, from, to } = args;
    if (!from.trim() || !to.trim()) { return 'Error: both "from" and "to" must be non-empty.'; }

    const filePath = path.join(root, '.bindery', 'translations.json');
    let translations: TranslationsFile = {};
    if (fs.existsSync(filePath)) {
        try { translations = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TranslationsFile; }
        catch { return 'Error: failed to parse .bindery/translations.json'; }
    }

    // Default source: EN (from settings) or 'en'
    let sourceLanguage = 'en';
    const settings = readSettings(root) as { languages?: Array<{ code: string; isDefault?: boolean }> } | null;
    const defaultLang = (settings?.languages ?? []).find(l => l.isDefault) ?? settings?.languages?.[0];
    if (defaultLang) { sourceLanguage = defaultLang.code.toLowerCase(); }

    const key = targetLangCode.toLowerCase();
    if (!translations[key]) {
        translations[key] = { type: 'glossary', sourceLanguage, rules: [], ignoredWords: [] };
    }
    const entry = translations[key];
    const rules = entry.rules ?? [];
    const idx   = rules.findIndex(r => r.from.toLowerCase() === from.toLowerCase());
    const isUpdate = idx >= 0;
    if (isUpdate) { rules[idx] = { from, to }; }
    else           { rules.push({ from, to }); rules.sort((a, b) => a.from.localeCompare(b.from)); }
    entry.rules = rules;

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(translations, null, 2) + '\n', 'utf-8');

    return `${isUpdate ? 'Updated' : 'Added'} glossary: ${from} → ${to} (${key})`;
}

// ─── add_dialect ──────────────────────────────────────────────────────────────

export interface AddDialectArgs {
    /** Dialect code used as key in translations.json, e.g. 'en-gb'. */
    dialectCode: string;
    from:        string;
    to:          string;
}

export function toolAddDialect(root: string, args: AddDialectArgs): string {
    const { dialectCode, from, to } = args;
    if (!from.trim() || !to.trim()) { return 'Error: both "from" and "to" must be non-empty.'; }

    const filePath = path.join(root, '.bindery', 'translations.json');
    let translations: TranslationsFile = {};
    if (fs.existsSync(filePath)) {
        try { translations = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TranslationsFile; }
        catch { return 'Error: failed to parse .bindery/translations.json'; }
    }

    const key = dialectCode.toLowerCase();
    if (!translations[key]) {
        translations[key] = { type: 'substitution', sourceLanguage: 'en', rules: [], ignoredWords: [] };
    }
    const entry = translations[key];
    if (entry.type !== 'substitution') {
        return `Error: entry '${key}' has type '${entry.type}', expected 'substitution'. Use add_translation for glossary entries.`;
    }

    const rules    = entry.rules ?? [];
    const fromLower = from.toLowerCase();
    const idx       = rules.findIndex(r => r.from.toLowerCase() === fromLower);
    const isUpdate  = idx >= 0;
    if (isUpdate) { rules[idx] = { from: fromLower, to }; }
    else           { rules.push({ from: fromLower, to }); rules.sort((a, b) => a.from.localeCompare(b.from)); }
    entry.rules = rules;

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(translations, null, 2) + '\n', 'utf-8');

    return `${isUpdate ? 'Updated' : 'Added'} dialect rule: ${fromLower} → ${to} (${key})`;
}

// ─── get_dialect ──────────────────────────────────────────────────────────────

export interface GetDialectArgs {
    dialectCode: string;
    word?:       string;
}

export function toolGetDialect(root: string, args: GetDialectArgs): string {
    const filePath = path.join(root, '.bindery', 'translations.json');
    if (!fs.existsSync(filePath)) {
        return 'No translations.json found. Run "init_workspace" or "add_dialect" first.';
    }

    let translations: TranslationsFile;
    try { translations = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TranslationsFile; }
    catch { return 'Error: failed to parse .bindery/translations.json'; }

    const key = Object.keys(translations).find(k => k.toLowerCase() === args.dialectCode.toLowerCase());
    if (!key) {
        const available = Object.entries(translations)
            .filter(([, e]) => e.type === 'substitution')
            .map(([k]) => k).join(', ');
        return `No dialect entry "${args.dialectCode}". Available: ${available || 'none'}`;
    }

    const entry = translations[key];
    if (entry.type !== 'substitution') {
        return `Entry "${key}" is type "${entry.type}", not "substitution". Use get_translation for glossary entries.`;
    }

    const rules = entry.rules ?? [];
    if (!args.word) {
        if (rules.length === 0) { return `No dialect rules defined for "${key}" yet.`; }
        const labelPart = entry.label ? ` — ${entry.label}` : '';
        const header = `${key}${labelPart} (${rules.length} substitution rules):`;
        return [header, ...rules.map(r => `  ${r.from}  →  ${r.to}`)].join('\n');
    }

    const stems   = wordStems(args.word.toLowerCase());
    const matches = rules.filter(r => stems.includes(r.from.toLowerCase()));
    if (matches.length === 0) { return `"${args.word}" not found in dialect "${key}".`; }
    return matches.map(r => `${r.from}  →  ${r.to}  [${key}]`).join('\n');
}

// ─── add_language ─────────────────────────────────────────────────────────────

export interface AddLanguageArgs {
    code:           string;
    folderName?:    string;
    chapterWord?:   string;
    actPrefix?:     string;
    prologueLabel?: string;
    epilogueLabel?: string;
    /** Mirror source language's folder structure with empty stubs. Default true. */
    createStubs?:   boolean;
}

export function toolAddLanguage(root: string, args: AddLanguageArgs): string {
    const settingsPath = path.join(root, '.bindery', 'settings.json');

    let existing: Record<string, unknown> = {};
    try { existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>; }
    catch { return 'Error: .bindery/settings.json not found. Run init_workspace first.'; }

    const upper = args.code.trim().toUpperCase();
    const folderName = normalizeFolderName(args.folderName?.trim() ?? upper);
    if (!folderName) {
        return 'Error: folderName must be a single relative folder name inside Story/.';
    }
    const newLang: LanguageEntry = {
        code:          upper,
        folderName,
        chapterWord:   args.chapterWord?.trim()   ?? 'Chapter',
        actPrefix:     args.actPrefix?.trim()     ?? 'Act',
        prologueLabel: args.prologueLabel?.trim() ?? 'Prologue',
        epilogueLabel: args.epilogueLabel?.trim() ?? 'Epilogue',
    };

    const languages: LanguageEntry[] = ((existing['languages'] as LanguageEntry[] | undefined) ?? []);
    const dupIdx = languages.findIndex(l => l.code.toUpperCase() === upper);
    if (dupIdx >= 0) { languages[dupIdx] = newLang; } else { languages.push(newLang); }
    existing['languages'] = languages;

    const settingsValidationError = validateWorkspaceSettingsPaths(existing);
    if (settingsValidationError) {
        return `Error: ${settingsValidationError}`;
    }

    fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');

    // Create stub files mirroring source language (default: true)
    const createStubs = args.createStubs !== false;
    const storyFolderName = (existing['storyFolder'] as string | undefined) ?? 'Story';
    const sourceLang = languages.find((l: LanguageEntry) => l.isDefault) ?? languages[0];

    let stubCount = 0;
    if (createStubs && sourceLang && sourceLang.code !== upper) {
        const sourceDir = resolveWorkspacePath(root, path.posix.join(storyFolderName, sourceLang.folderName));
        const targetDir = resolveWorkspacePath(root, path.posix.join(storyFolderName, newLang.folderName));
        if (!targetDir) {
            return `Error: invalid language folder target for ${upper}.`;
        }
        fs.mkdirSync(targetDir, { recursive: true });

        if (sourceDir && fs.existsSync(sourceDir)) {
            const createStubsIn = (srcDir: string, dstDir: string) => {
                fs.mkdirSync(dstDir, { recursive: true });
                for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
                    const srcPath = path.join(srcDir, entry.name);
                    const dstPath = path.join(dstDir, entry.name);
                    if (entry.isDirectory()) {
                        createStubsIn(srcPath, dstPath);
                    } else if (entry.isFile() && entry.name.endsWith('.md')) {
                        if (!fs.existsSync(dstPath)) {
                            const src    = fs.readFileSync(srcPath, 'utf-8');
                            const h1     = /^#\s+(.+)/m.exec(src);
                            const title  = h1 ? h1[1].trim() : path.basename(entry.name, '.md');
                            fs.writeFileSync(dstPath, `# [Untranslated] ${title}\n`, 'utf-8');
                            stubCount++;
                        }
                    }
                }
            };
            createStubsIn(sourceDir, targetDir);
        }
    }

    return `Added language ${upper} to settings.json. Story/${newLang.folderName}/ created with ${stubCount} stub file(s).`;
}

// ─── Local settings reader ────────────────────────────────────────────────────
// toolAddTranslation only needs the default language code from settings.json.
// Kept local to avoid a dependency on tools.ts (which would create a cycle).

function readSettings(root: string): Record<string, unknown> | null {
    const filePath = path.join(root, '.bindery', 'settings.json');
    if (!fs.existsSync(filePath)) { return null; }
    try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>; }
    catch { return null; }
}
