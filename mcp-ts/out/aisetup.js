"use strict";
/**
 * AI instruction file generation for Bindery (MCP server).
 *
 * Generates CLAUDE.md, .github/copilot-instructions.md, .cursor/rules,
 * AGENTS.md, and .claude/skills/<skill>/SKILL.md from the book's
 * .bindery/settings.json.
 *
 * Templates live in templates.ts — the single source of truth.
 * vscode-ext/src/ai-setup.ts imports its copy via ai-setup-templates.ts.
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
exports.AI_SETUP_VERSION = exports.ALL_SKILLS = void 0;
exports.setupAiFiles = setupAiFiles;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const templates_js_1 = require("./templates.js");
exports.ALL_SKILLS = [
    'review', 'brainstorm', 'memory', 'translate', 'status', 'continuity', 'read_aloud',
];
/**
 * Bump this integer whenever templates change significantly enough that
 * existing users should regenerate their AI files.
 * Must be kept in sync with AI_SETUP_VERSION in vscode-ext/src/ai-setup.ts.
 */
exports.AI_SETUP_VERSION = 5;
// ─── Context builder ──────────────────────────────────────────────────────────
function buildContext(s) {
    const title = (typeof s.bookTitle === 'string' ? s.bookTitle : undefined) ?? 'Untitled';
    const author = s.author ?? '';
    const description = s.description ?? '';
    const genre = s.genre ?? '';
    const audience = s.targetAudience ?? '';
    const storyFolder = s.storyFolder ?? 'Story';
    const languages = s.languages ?? [];
    const langList = languages.length > 0
        ? languages.map((l, i) => i === 0 ? `${l.code} (source)` : `${l.code} (translation)`).join(', ')
        : 'EN (source)';
    return {
        title, author, description, genre, audience,
        storyFolder, notesFolder: 'Notes', arcFolder: 'Arc',
        memoriesFolder: '.bindery/memories',
        languages, langList,
        hasMultiLang: languages.length > 1,
    };
}
// ─── Entry point ──────────────────────────────────────────────────────────────
function setupAiFiles(options) {
    const { root, targets, skills = exports.ALL_SKILLS, overwrite = false } = options;
    const settingsPath = path.join(root, '.bindery', 'settings.json');
    if (!fs.existsSync(settingsPath)) {
        throw new Error('settings.json not found — run init_workspace first.');
    }
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const ctx = buildContext(settings);
    const result = { created: [], skipped: [] };
    for (const target of targets) {
        switch (target) {
            case 'claude':
                writeFile(root, 'CLAUDE.md', (0, templates_js_1.renderTemplate)('claude', ctx), overwrite, result);
                for (const skill of skills) {
                    writeFile(root, path.join('.claude', 'skills', skill, 'SKILL.md'), (0, templates_js_1.renderTemplate)(skill, ctx), overwrite, result);
                }
                break;
            case 'copilot':
                writeFile(root, path.join('.github', 'copilot-instructions.md'), (0, templates_js_1.renderTemplate)('copilot', ctx), overwrite, result);
                break;
            case 'cursor':
                writeFile(root, path.join('.cursor', 'rules'), (0, templates_js_1.renderTemplate)('cursor', ctx), overwrite, result);
                break;
            case 'agents':
                writeFile(root, 'AGENTS.md', (0, templates_js_1.renderTemplate)('agents', ctx), overwrite, result);
                break;
        }
    }
    stampAiVersion(root);
    return result;
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
function writeFile(root, relPath, content, overwrite, result) {
    const full = path.join(root, relPath);
    if (fs.existsSync(full) && !overwrite) {
        result.skipped.push(relPath);
        return;
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
    result.created.push(relPath);
}
function stampAiVersion(root) {
    const dir = path.join(root, '.bindery');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ai-version.json'), JSON.stringify({ version: exports.AI_SETUP_VERSION }, null, 2) + '\n', 'utf-8');
}
//# sourceMappingURL=aisetup.js.map