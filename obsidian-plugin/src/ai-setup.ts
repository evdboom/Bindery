/**
 * Obsidian-specific AI setup wrapper.
 *
 * Generates AI instruction files (CLAUDE.md, copilot-instructions.md, .cursor/rules, AGENTS.md)
 * and Claude skill templates from the book's .bindery/settings.json.
 *
 * For Obsidian, this is a simpler adaptation since we don't have the VS Code LM API,
 * so we just generate the files to the filesystem directly.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { App } from 'obsidian';
import {
    BINDERY_FOLDER,
    SETTINGS_FILENAME,
    getArcFolder,
    getArcGranularity,
    getCharactersFolder,
    getNotesFolder,
    getSessionFile,
    getStoryFolder,
    renderTemplate,
    type TemplateContext,
    type WorkspaceSettings,
} from '@bindery/core';

export type AiTarget = 'claude' | 'copilot' | 'cursor' | 'agents';
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
    | 'proof-read'
    | 'plan-beats'
    | 'character-setup';

export const ALL_SKILLS: SkillTemplate[] = [
    'review', 'brainstorm', 'memory', 'translate', 'translation-review',
    'status', 'continuity', 'read-aloud', 'read-in', 'proof-read', 'plan-beats', 'character-setup',
];

export interface AiSetupResult {
    created: string[];
    skipped: string[];
}

/**
 * Generate AI instruction files from vault settings.
 */
export function setupAiFiles(
    _app: App,
    bookRoot: string,
    targets: AiTarget[] = ['claude', 'copilot'],
    skills: SkillTemplate[] = ALL_SKILLS,
    overwrite: boolean = false
): AiSetupResult {
    const settingsPath = path.join(bookRoot, BINDERY_FOLDER, SETTINGS_FILENAME);
    if (!fs.existsSync(settingsPath)) {
        throw new Error(`.bindery/settings.json not found. Run "Bindery: Initialize workspace" first.`);
    }

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
    const result: AiSetupResult = { created: [], skipped: [] };

    const ctx: TemplateContext = buildContext(settings);

    // Generate target-specific files
    for (const target of targets) {
        switch (target) {
            case 'claude':
                writeFile(bookRoot, 'CLAUDE.md', renderTemplate('claude', ctx), overwrite, result);
                for (const skill of skills) {
                    const skillDir = path.join('.claude', 'skills', skill);
                    writeFile(bookRoot, path.join(skillDir, 'SKILL.md'), renderTemplate(skill, ctx), overwrite, result);
                }
                break;
            case 'copilot':
                writeFile(bookRoot, path.join('.github', 'copilot-instructions.md'), renderTemplate('copilot', ctx), overwrite, result);
                break;
            case 'cursor':
                writeFile(bookRoot, path.join('.cursor', 'rules'), renderTemplate('cursor', ctx), overwrite, result);
                break;
            case 'agents':
                writeFile(bookRoot, 'AGENTS.md', renderTemplate('agents', ctx), overwrite, result);
                break;
        }
    }

    return result;
}

/**
 * Build template context from settings.
 */
function buildContext(settings: Record<string, unknown>): TemplateContext {
    const title = titleFromSetting(settings.bookTitle);
    const author = (typeof settings.author === 'string' ? settings.author : undefined) ?? '';
    const description = (typeof settings.description === 'string' ? settings.description : undefined) ?? '';
    const genre = (typeof settings.genre === 'string' ? settings.genre : undefined) ?? '';
    const audience = (typeof settings.targetAudience === 'string' ? settings.targetAudience : undefined) ?? '';
    const pathSettings = settings as WorkspaceSettings;
    const storyFolder = getStoryFolder(pathSettings);
    const notesFolder = getNotesFolder(pathSettings);
    const arcFolder = getArcFolder(pathSettings);
    const memoriesFolder = '.bindery/memories';

    const rawLanguages = settings.languages;
    const languages: Array<{ code: string; folderName: string }> = Array.isArray(rawLanguages)
        ? (rawLanguages as unknown[]).filter(
              (l): l is { code: string; folderName: string } =>
                  typeof (l as Record<string, unknown>)?.code === 'string' &&
                  typeof (l as Record<string, unknown>)?.folderName === 'string'
          )
        : [];

    const langList = languages.length > 0
        ? languages.map((l, i) => i === 0 ? `${l.code} (source)` : `${l.code} (translation)`).join(', ')
        : 'EN (source)';

    return {
        title,
        author,
        description,
        genre,
        audience,
        storyFolder,
        notesFolder,
        arcFolder,
        charactersFolder: getCharactersFolder(pathSettings),
        sessionFile: getSessionFile(pathSettings),
        arcGranularity: getArcGranularity(pathSettings),
        languages,
        langList,
        hasMultiLang: languages.length > 1,
        memoriesFolder,
    };
}

function titleFromSetting(value: unknown): string {
    if (typeof value === 'string' && value.trim()) { return value.trim(); }
    if (value && typeof value === 'object') {
        const titles = value as Record<string, unknown>;
        const en = titles['en'];
        if (typeof en === 'string' && en.trim()) { return en.trim(); }
        const first = Object.values(titles).find(v => typeof v === 'string' && v.trim());
        if (typeof first === 'string') { return first.trim(); }
    }
    return 'Untitled';
}

/**
 * Write a single file, respecting overwrite flag.
 */
function writeFile(
    bookRoot: string,
    relPath: string,
    content: string,
    overwrite: boolean,
    result: AiSetupResult
): void {
    const absPath = path.join(bookRoot, relPath);
    const dir = path.dirname(absPath);

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(absPath) && !overwrite) {
        result.skipped.push(relPath);
        return;
    }

    fs.writeFileSync(absPath, content, 'utf-8');
    result.created.push(relPath);
}
