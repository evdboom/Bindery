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

import * as fs   from 'node:fs';
import * as path from 'node:path';
import { renderTemplate, type TemplateContext } from './templates.js';

// ─── Public types ─────────────────────────────────────────────────────────────

export type AiTarget = 'claude' | 'copilot' | 'cursor' | 'agents';

export type SkillTemplate =
    | 'review'
    | 'brainstorm'
    | 'memory'
    | 'translate'
    | 'status'
    | 'continuity'
    | 'read_aloud';

export const ALL_SKILLS: SkillTemplate[] = [
    'review', 'brainstorm', 'memory', 'translate', 'status', 'continuity', 'read_aloud',
];

export interface AiSetupOptions {
    root:       string;
    targets:    AiTarget[];
    skills?:    SkillTemplate[];
    overwrite?: boolean;
}

export interface AiSetupResult {
    created: string[];
    skipped: string[];
}

/**
 * Bump this integer whenever templates change significantly enough that
 * existing users should regenerate their AI files.
 * Must be kept in sync with AI_SETUP_VERSION in vscode-ext/src/ai-setup.ts.
 */
export const AI_SETUP_VERSION = 5;

// ─── Settings types ───────────────────────────────────────────────────────────

interface Settings {
    bookTitle?:      string | Record<string, string>;
    author?:         string;
    description?:    string;
    genre?:          string;
    targetAudience?: string;
    storyFolder?:    string;
    languages?:      Array<{ code: string; folderName: string }>;
}

// ─── Context builder ──────────────────────────────────────────────────────────

function buildContext(s: Settings): TemplateContext {
    const title       = (typeof s.bookTitle === 'string' ? s.bookTitle : undefined) ?? 'Untitled';
    const author      = s.author         ?? '';
    const description = s.description    ?? '';
    const genre       = s.genre          ?? '';
    const audience    = s.targetAudience ?? '';
    const storyFolder = s.storyFolder    ?? 'Story';
    const languages   = s.languages      ?? [];

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

export function setupAiFiles(options: AiSetupOptions): AiSetupResult {
    const { root, targets, skills = ALL_SKILLS, overwrite = false } = options;

    const settingsPath = path.join(root, '.bindery', 'settings.json');
    if (!fs.existsSync(settingsPath)) {
        throw new Error('settings.json not found — run init_workspace first.');
    }
    const settings: Settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Settings;
    const ctx = buildContext(settings);

    const result: AiSetupResult = { created: [], skipped: [] };

    for (const target of targets) {
        switch (target) {
            case 'claude':
                writeFile(root, 'CLAUDE.md', renderTemplate('claude', ctx), overwrite, result);
                for (const skill of skills) {
                    writeFile(root, path.join('.claude', 'skills', skill, 'SKILL.md'), renderTemplate(skill, ctx), overwrite, result);
                }
                break;
            case 'copilot':
                writeFile(root, path.join('.github', 'copilot-instructions.md'), renderTemplate('copilot', ctx), overwrite, result);
                break;
            case 'cursor':
                writeFile(root, path.join('.cursor', 'rules'), renderTemplate('cursor', ctx), overwrite, result);
                break;
            case 'agents':
                writeFile(root, 'AGENTS.md', renderTemplate('agents', ctx), overwrite, result);
                break;
        }
    }

    stampAiVersion(root);
    return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writeFile(root: string, relPath: string, content: string, overwrite: boolean, result: AiSetupResult): void {
    const full = path.join(root, relPath);
    if (fs.existsSync(full) && !overwrite) {
        result.skipped.push(relPath);
        return;
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
    result.created.push(relPath);
}

function stampAiVersion(root: string): void {
    const dir = path.join(root, '.bindery');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'ai-version.json'),
        JSON.stringify({ version: AI_SETUP_VERSION }, null, 2) + '\n',
        'utf-8'
    );
}
