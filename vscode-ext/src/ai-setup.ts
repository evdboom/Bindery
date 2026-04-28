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
 * Templates and TemplateContext live in @bindery/core (single source of truth).
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';
import type { WorkspaceSettings } from './workspace';
import { renderTemplate, type TemplateContext } from '@bindery/core';

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
    | 'translation-review'
    | 'status'
    | 'continuity'
    | 'read-aloud'
    | 'read-in'
    | 'proof-read';

export const ALL_SKILLS: SkillTemplate[] = [
    'review', 'brainstorm', 'memory', 'translate', 'translation-review', 'status', 'continuity', 'read-aloud', 'read-in', 'proof-read',
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

// ─── Context builder ──────────────────────────────────────────────────────────

function buildContext(s: WorkspaceSettings): TemplateContext {
    const title       = (typeof s.bookTitle === 'string' ? s.bookTitle : undefined) ?? 'Untitled';
    const author      = s.author      ?? '';
    const description = s.description ?? '';
    const genre       = s.genre       ?? '';
    const audience    = s.targetAudience ?? '';
    const storyFolder = s.storyFolder  ?? 'Story';
    const notesFolder = 'Notes';
    const arcFolder   = 'Arc';
    const languages: Array<{ code: string; folderName: string }> = s.languages ?? [];

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

