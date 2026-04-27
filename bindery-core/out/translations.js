"use strict";
/**
 * Bindery translation types and helpers.
 *
 * Manages .bindery/translations.json — substitution rules and glossaries
 * per language pair.
 *
 * Shared across vscode-ext, obsidian-plugin, and mcp-ts.
 * Zero dependency on VS Code or Obsidian APIs.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.readTranslations = readTranslations;
exports.writeTranslations = writeTranslations;
exports.getSubstitutionRules = getSubstitutionRules;
exports.getIgnoredWords = getIgnoredWords;
exports.getGlossaryRules = getGlossaryRules;
exports.upsertSubstitutionRule = upsertSubstitutionRule;
exports.addIgnoredWords = addIgnoredWords;
exports.upsertGlossaryRule = upsertGlossaryRule;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const settings_1 = require("./settings");
// ─── Readers ─────────────────────────────────────────────────────────────────
function readTranslations(root) {
    const p = (0, settings_1.getTranslationsPath)(root);
    if (!fs.existsSync(p)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
    catch {
        return null;
    }
}
// ─── Writers ─────────────────────────────────────────────────────────────────
function writeTranslations(root, data) {
    const p = (0, settings_1.getTranslationsPath)(root);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
// ─── Accessors ────────────────────────────────────────────────────────────────
/**
 * Get substitution rules from translations.json for the given language key.
 * Returns UkReplacement[] compatible with merge.ts (field names us/uk).
 * Only entries with type === 'substitution' are returned.
 */
function getSubstitutionRules(translations, langKey) {
    if (!translations) {
        return [];
    }
    const entry = resolveEntry(translations, langKey);
    if (entry?.type !== 'substitution') {
        return [];
    }
    return (entry.rules ?? [])
        .filter(r => r.from?.trim() && r.to?.trim())
        .map(r => ({ us: r.from.trim().toLowerCase(), uk: r.to.trim() }));
}
/**
 * Get the ignored-words set for a given language key.
 */
function getIgnoredWords(translations, langKey) {
    if (!translations) {
        return new Set();
    }
    const entry = resolveEntry(translations, langKey);
    const result = new Set();
    for (const word of entry?.ignoredWords ?? []) {
        const w = word.trim().toLowerCase();
        if (w) {
            result.add(w);
        }
    }
    return result;
}
/**
 * Get glossary rules for a language key (type === 'glossary' entries).
 */
function getGlossaryRules(translations, langKey) {
    if (!translations) {
        return [];
    }
    const entry = resolveEntry(translations, langKey);
    if (!entry) {
        return [];
    }
    return (entry.rules ?? []).filter(r => r.from?.trim() && r.to?.trim());
}
// ─── Mutators ─────────────────────────────────────────────────────────────────
/**
 * Add or update a substitution rule in .bindery/translations.json.
 * Creates the file and entry if they do not yet exist.
 */
function upsertSubstitutionRule(root, langKey, rule) {
    const translations = readTranslations(root) ?? {};
    if (!translations[langKey]) {
        translations[langKey] = {
            type: 'substitution',
            sourceLanguage: 'en',
            rules: [],
            ignoredWords: [],
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
    }
    else {
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
function addIgnoredWords(root, langKey, words) {
    const translations = readTranslations(root) ?? {};
    if (!translations[langKey]) {
        translations[langKey] = {
            type: 'substitution',
            sourceLanguage: 'en',
            rules: [],
            ignoredWords: [],
        };
    }
    const entry = translations[langKey];
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
function upsertGlossaryRule(root, langKey, langLabel, sourceLang, rule) {
    const translations = readTranslations(root) ?? {};
    if (!translations[langKey]) {
        translations[langKey] = {
            label: langLabel,
            type: 'glossary',
            sourceLanguage: sourceLang,
            rules: [],
        };
    }
    const entry = translations[langKey];
    // If entry exists but was previously substitution, keep it — don't downgrade
    const rules = entry.rules ?? [];
    const idx = rules.findIndex(r => r.from.toLowerCase() === rule.from.toLowerCase());
    if (idx >= 0) {
        rules[idx] = rule;
    }
    else {
        rules.push(rule);
        rules.sort((a, b) => a.from.localeCompare(b.from));
    }
    entry.rules = rules;
    writeTranslations(root, translations);
}
// ─── Internal helpers ─────────────────────────────────────────────────────────
function normaliseKey(key) {
    return key.trim().toLowerCase();
}
function isUkLike(key) {
    const k = normaliseKey(key);
    return k === 'uk' || k === 'en-gb' || k === 'en-uk';
}
/**
 * Look up a translation entry by language key.
 * Falls back to 'en-gb' for UK-like codes.
 */
function resolveEntry(translations, langKey) {
    const target = normaliseKey(langKey);
    for (const [k, v] of Object.entries(translations)) {
        if (normaliseKey(k) === target) {
            return v;
        }
    }
    // For UK-like codes, also accept an 'en-gb' entry
    if (isUkLike(target)) {
        for (const [k, v] of Object.entries(translations)) {
            if (normaliseKey(k) === 'en-gb') {
                return v;
            }
        }
    }
    return undefined;
}
//# sourceMappingURL=translations.js.map