/**
 * Bindery — AI assistant setup
 *
 * Generates AI assistant instruction files and Claude skill templates from
 * the project's .bindery/settings.json. Each target produces different files:
 *
 *   claude    → CLAUDE.md + .claude/skills/<skill>/SKILL.md
 *   copilot   → .github/copilot-instructions.md
 *   cursor    → .cursor/rules
 *   agents    → AGENTS.md  (OpenAI Agents, Aider, Codex, etc.)
 *
 * Templates live in ai-setup-templates.ts, which is a copy of
 * mcp-ts/src/templates.ts — the single source of truth.
 * The copy is kept in sync by the CI workflow and locally via:
 *   cp mcp-ts/src/templates.ts vscode-ext/src/ai-setup-templates.ts
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';
import type { WorkspaceSettings } from './workspace';
import type { LanguageConfig }    from './merge';
import { renderTemplate }         from './ai-setup-templates';

// ─── Public types ─────────────────────────────────────────────────────────────

export type AiTarget = 'claude' | 'copilot' | 'cursor' | 'agents';

export interface AiSetupOptions {
    root:        string;
    settings:    WorkspaceSettings;
    targets:     AiTarget[];
    /** Skills to generate for the claude target. */
    skills?:     SkillTemplate[];
    /** Overwrite existing files? Default false (skip existing). */
    overwrite?:  boolean;
}

export interface AiSetupResult {
    created:  string[];   // files created
    skipped:  string[];   // files that existed and were not overwritten
}

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

/**
 * Bump this number whenever the generated skill/instruction templates change
 * significantly enough that existing users should regenerate their AI files.
 * Written to .bindery/ai-version.json after each successful setupAiFiles() run.
 */
export const AI_SETUP_VERSION = 5;

// ─── Entry point ──────────────────────────────────────────────────────────────

export function setupAiFiles(options: AiSetupOptions): AiSetupResult {
    const { root, settings, targets, skills = ALL_SKILLS, overwrite = false } = options;
    const result: AiSetupResult = { created: [], skipped: [] };

    const ctx = buildContext(settings);

    for (const target of targets) {
        switch (target) {
            case 'claude':
                writeFile(root, 'CLAUDE.md', renderTemplate('claude', ctx), overwrite, result);
                for (const skill of skills) {
                    const skillDir = path.join('.claude', 'skills', skill);
                    writeFile(root, path.join(skillDir, 'SKILL.md'), renderTemplate(skill, ctx), overwrite, result);
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

// ─── Version stamp ────────────────────────────────────────────────────────────

/** Read the ai-version.json version number, or 0 if absent / unreadable. */
export function readAiSetupVersion(root: string): number {
    const p = path.join(root, '.bindery', 'ai-version.json');
    if (!fs.existsSync(p)) { return 0; }
    try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as { version?: unknown };
        return typeof raw.version === 'number' ? raw.version : 0;
    } catch { return 0; }
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

interface TemplateContext {
    title:          string;
    author:         string;
    description:    string;
    genre:          string;
    audience:       string;
    storyFolder:    string;
    notesFolder:    string;
    arcFolder:      string;
    memoriesFolder: string;
    languages:      LanguageConfig[];
    langList:       string;
    hasMultiLang:   boolean;
}

function buildContext(s: WorkspaceSettings): TemplateContext {
    const title       = (typeof s.bookTitle === 'string' ? s.bookTitle : undefined) ?? 'Untitled';
    const author      = s.author      ?? '';
    const description = s.description ?? '';
    const genre       = s.genre       ?? '';
    const audience    = s.targetAudience ?? '';
    const storyFolder = s.storyFolder  ?? 'Story';
    const notesFolder = 'Notes';
    const arcFolder   = 'Arc';
    const languages   = s.languages   ?? [];

    const langList = languages.length > 0
        ? languages.map((l, i) => i === 0 ? `${l.code} (source)` : `${l.code} (translation)`).join(', ')
        : 'EN (source)';

    return { title, author, description, genre, audience, storyFolder, notesFolder, arcFolder, languages, langList, hasMultiLang: languages.length > 1, memoriesFolder: '.bindery/memories' };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writeFile(
    root:      string,
    relPath:   string,
    content:   string,
    overwrite: boolean,
    result:    AiSetupResult
): void {
    const full = path.join(root, relPath);
    if (fs.existsSync(full) && !overwrite) {
        result.skipped.push(relPath);
        return;
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
    result.created.push(relPath);
}

