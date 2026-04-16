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
 * Templates live in mcp-ts/src/templates.ts — the single source of truth.
 * ai-setup-templates.ts is only an optional generated copy used by packaged
 * builds and some local test/build flows.
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';
import type { WorkspaceSettings } from './workspace';
import type { LanguageConfig }    from './merge';

// ─── Resilient template loader ────────────────────────────────────────────────
// mcp-ts/src/templates.ts is the source of truth inside the mono-repo.
// ai-setup-templates.ts is an optional generated copy for packaged builds.
// That means the copy should be removable in normal repo development.

// Forward-reference is fine in TypeScript — TemplateContext is defined below.
// eslint-disable-next-line @typescript-eslint/no-use-before-define
type RenderTemplateFn = (name: string, ctx: TemplateContext) => string;

function loadRenderTemplate(): RenderTemplateFn {
    // 1. Preferred in the mono-repo: the source-of-truth template file.
    //    __dirname is `vscode-ext/out/` in compiled output and `vscode-ext/src/`
    //    in ts-node/vitest, so two levels up lands at the repo root.
    const fallbackPath = path.resolve(__dirname, '..', '..', 'mcp-ts', 'src', 'templates');
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(fallbackPath) as { renderTemplate: RenderTemplateFn };
        return mod.renderTemplate;
    } catch {
        // source not available — fall through to packaged-copy fallback
    }

    // 2. Packaged-build fallback: generated copy inside vscode-ext/src.
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('./ai-setup-templates') as { renderTemplate: RenderTemplateFn };
        return mod.renderTemplate;
    } catch {
        // copy also missing — give a clear, actionable error
    }

    throw new Error(
        'Bindery: template file not found.\n' +
        'Expected either the repo source template at mcp-ts/src/templates.ts\n' +
        'or the optional generated copy at vscode-ext/src/ai-setup-templates.ts.\n' +
        'In normal repo development, the generated copy can be absent.\n' +
        'If you are running a packaged/local build that depends on the copy, regenerate it or build from the repo root.',
    );
}

const renderTemplate = loadRenderTemplate();

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
    | 'read-aloud'
    | 'read-in'
    | 'proof-read';

export const ALL_SKILLS: SkillTemplate[] = [
    'review', 'brainstorm', 'memory', 'translate', 'status', 'continuity', 'read-aloud', 'read-in', 'proof-read',
];

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

    return result;
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

