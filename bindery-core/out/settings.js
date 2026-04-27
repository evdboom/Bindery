"use strict";
/**
 * Bindery workspace settings types and helpers.
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
exports.TRANSLATIONS_FILENAME = exports.SETTINGS_FILENAME = exports.BINDERY_FOLDER = void 0;
exports.getBinderyFolder = getBinderyFolder;
exports.getSettingsPath = getSettingsPath;
exports.getTranslationsPath = getTranslationsPath;
exports.readWorkspaceSettings = readWorkspaceSettings;
exports.getBookTitleForLang = getBookTitleForLang;
exports.getDefaultLanguage = getDefaultLanguage;
exports.getDialectsForLanguage = getDialectsForLanguage;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
// ─── Constants ───────────────────────────────────────────────────────────────
exports.BINDERY_FOLDER = '.bindery';
exports.SETTINGS_FILENAME = 'settings.json';
exports.TRANSLATIONS_FILENAME = 'translations.json';
// ─── Path helpers ─────────────────────────────────────────────────────────────
function getBinderyFolder(root) {
    return path.join(root, exports.BINDERY_FOLDER);
}
function getSettingsPath(root) {
    return path.join(root, exports.BINDERY_FOLDER, exports.SETTINGS_FILENAME);
}
function getTranslationsPath(root) {
    return path.join(root, exports.BINDERY_FOLDER, exports.TRANSLATIONS_FILENAME);
}
// ─── Readers ─────────────────────────────────────────────────────────────────
function readWorkspaceSettings(root) {
    const p = getSettingsPath(root);
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
// ─── Accessors ────────────────────────────────────────────────────────────────
/**
 * Resolve the book title for a given language code.
 * Falls back to the English title if no language-specific title is found.
 */
function getBookTitleForLang(settings, langCode) {
    if (!settings?.bookTitle) {
        return undefined;
    }
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
function getDefaultLanguage(settings) {
    const langs = settings?.languages;
    if (!langs || langs.length === 0) {
        return undefined;
    }
    return langs.find(l => l.isDefault) ?? langs[0];
}
/**
 * Return dialects[] for the language matching langCode, or [].
 */
function getDialectsForLanguage(settings, langCode) {
    const lang = settings?.languages?.find(l => l.code.toUpperCase() === langCode.toUpperCase());
    return lang?.dialects ?? [];
}
//# sourceMappingURL=settings.js.map