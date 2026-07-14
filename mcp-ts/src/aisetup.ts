/**
 * AI instruction file generation for Bindery (MCP server).
 *
 * Generates CLAUDE.md, .github/copilot-instructions.md, .cursor/rules,
 * AGENTS.md, and .claude/skills/<skill>/SKILL.md from the book's
 * .bindery/settings.json.
 *
 * Template content is maintained in bindery-core/src/templates/*.ts
 * (each template lives under ./templates/ there). mcp-ts/src/templates.ts
 * is a local re-export shim for stable imports.
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';
import {
    renderTemplate,
    FILE_VERSION_INFO,
    getArcFolder,
    getArcGranularity,
    getCharactersFolder,
    getNotesFolder,
    getSessionFile,
    getPreferencesFile,
    getStoryFolder,
    type TemplateContext,
    type WorkspaceSettings,
} from './templates.js';

// ─── Public types ─────────────────────────────────────────────────────────────

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
    'review', 'brainstorm', 'memory', 'translate', 'translation-review', 'status', 'continuity', 'read-aloud', 'read-in', 'proof-read', 'plan-beats', 'character-setup',
];

export interface AiSetupOptions {
    root:       string;
    targets:    AiTarget[];
    skills?:    SkillTemplate[];
    overwrite?: boolean;
}

export interface AiSetupResult {
    regenerated: string[];
    skipped: string[];
    skillZipManifest: {
        rebuilt: string[];
        created: string[];
        skipped: string[];
        failed: string[];
    };
    versionStamp: AiVersionFile;
}

interface AiVersionEntry {
    version: number;
    label: string;
    zip: string | null;
}

export interface AiVersionFile {
    versions: Record<string, AiVersionEntry>;
}

// ─── Settings types ───────────────────────────────────────────────────────────

interface Settings extends Omit<WorkspaceSettings, 'languages'> {
    languages?:      Array<{ code: string; folderName: string }>;
}

function titleFromSetting(value: Settings['bookTitle']): string {
    if (typeof value === 'string' && value.trim()) { return value.trim(); }
    if (value && typeof value === 'object') {
        const en = value['en'];
        if (typeof en === 'string' && en.trim()) { return en.trim(); }
        const first = Object.values(value).find(v => typeof v === 'string' && v.trim());
        if (typeof first === 'string') { return first.trim(); }
    }
    return 'Untitled';
}

// ─── Context builder ──────────────────────────────────────────────────────────

function buildContext(s: Settings): TemplateContext {
    const title       = titleFromSetting(s.bookTitle);
    const author      = s.author         ?? '';
    const description = s.description    ?? '';
    const genre       = s.genre          ?? '';
    const audience    = s.targetAudience ?? '';
    const storyFolder = getStoryFolder(s);
    const notesFolder = getNotesFolder(s);
    const arcFolder   = getArcFolder(s);
    const languages   = s.languages      ?? [];

    const langList = languages.length > 0
        ? languages.map((l, i) => i === 0 ? `${l.code} (source)` : `${l.code} (translation)`).join(', ')
        : 'EN (source)';

    return {
        title, author, description, genre, audience,
        storyFolder,
        notesFolder,
        arcFolder,
        charactersFolder: getCharactersFolder(s),
        sessionFile: getSessionFile(s),
        preferencesFile: getPreferencesFile(s),
        arcGranularity: getArcGranularity(s),
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

    const versionFile = readAiVersionFile(root);
    const result: AiSetupResult = {
        regenerated: [],
        skipped: [],
        skillZipManifest: { rebuilt: [], created: [], skipped: [], failed: [] },
        versionStamp: versionFile,
    };

    // The capabilities README is bindery-meta, not an AI target — always
    // refresh it so agents have a single canonical "what can Bindery do?" file.
    // Forced overwrite so a stale local copy is replaced even when the version
    // hasn't bumped.
    writeFile(root, path.join('.bindery', 'README.md'), renderTemplate('bindery-readme', ctx), true, versionFile, result);

    for (const target of targets) {
        switch (target) {
            case 'claude':
                writeFile(root, 'CLAUDE.md', renderTemplate('claude', ctx), overwrite, versionFile, result);
                for (const skill of skills) {
                    const skillMd = path.join('.claude', 'skills', skill, 'SKILL.md');
                    writeFile(root, skillMd, renderTemplate(skill, ctx), overwrite, versionFile, result);
                }
                break;
            case 'copilot':
                writeFile(root, path.join('.github', 'copilot-instructions.md'), renderTemplate('copilot', ctx), overwrite, versionFile, result);
                break;
            case 'cursor':
                writeFile(root, path.join('.cursor', 'rules'), renderTemplate('cursor', ctx), overwrite, versionFile, result);
                break;
            case 'agents':
                writeFile(root, 'AGENTS.md', renderTemplate('agents', ctx), overwrite, versionFile, result);
                break;
        }
    }

    stampAiVersionFile(root, versionFile);
    result.versionStamp = versionFile;
    return result;
}

export function readAiVersionFile(root: string): AiVersionFile {
    const p = path.join(root, '.bindery', 'ai-version.json');
    if (!fs.existsSync(p)) { return { versions: {} }; }
    try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as { versions?: unknown };
        if (raw.versions && typeof raw.versions === 'object') {
            const normalized: Record<string, AiVersionEntry> = {};
            for (const [k, v] of Object.entries(raw.versions as Record<string, AiVersionEntry>)) {
                normalized[toKey(k)] = v;
            }
            return { versions: normalized };
        }
        // Backward compatibility with the old single-version schema.
        return { versions: {} };
    } catch {
        return { versions: {} };
    }
}

export function expectedAiVersionEntries(): Record<string, AiVersionEntry> {
    const out: Record<string, AiVersionEntry> = {};
    for (const [file, info] of Object.entries(FILE_VERSION_INFO)) {
        out[file] = { version: info.version, label: info.label, zip: info.zip };
    }
    return out;
}

/**
 * Write `.bindery/README.md` (the capabilities reference) directly, without
 * touching any AI-target files. Used by `bindery init` so the doc exists from
 * the moment the workspace is created. Always overwrites — this file is
 * Bindery-managed and not meant for hand-editing.
 */
export function writeBinderyCapabilitiesReadme(root: string): void {
    const settingsPath = path.join(root, '.bindery', 'settings.json');
    if (!fs.existsSync(settingsPath)) {
        throw new Error('settings.json not found — run init_workspace first.');
    }
    const settings: Settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Settings;
    const ctx = buildContext(settings);

    const versionFile = readAiVersionFile(root);
    const result: AiSetupResult = {
        regenerated: [], skipped: [],
        skillZipManifest: { rebuilt: [], created: [], skipped: [], failed: [] },
        versionStamp: versionFile,
    };
    writeFile(root, path.join('.bindery', 'README.md'), renderTemplate('bindery-readme', ctx), true, versionFile, result);
    stampAiVersionFile(root, versionFile);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writeFile(
    root: string,
    relPath: string,
    content: string,
    overwrite: boolean,
    versionFile: AiVersionFile,
    result: AiSetupResult
): void {
    const full = path.join(root, relPath);
    const key = toKey(relPath);
    const expected = FILE_VERSION_INFO[key];
    const existingVersion = versionFile.versions[key]?.version ?? 0;
    const isUpToDate = expected ? existingVersion >= expected.version : true;

    if (fs.existsSync(full) && !overwrite && isUpToDate) {
        result.skipped.push(key);
        stampVersionEntry(versionFile, key);
        return;
    }

    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
    result.regenerated.push(key);
    stampVersionEntry(versionFile, key);
}

function stampVersionEntry(versionFile: AiVersionFile, relPath: string): void {
    const expected = FILE_VERSION_INFO[relPath];
    if (!expected) { return; }
    versionFile.versions[relPath] = {
        version: expected.version,
        label: expected.label,
        zip: expected.zip,
    };
}

function stampAiVersionFile(root: string, versionFile: AiVersionFile): void {
    const dir = path.join(root, '.bindery');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'ai-version.json'),
        JSON.stringify(versionFile, null, 2) + '\n',
        'utf-8'
    );
}

function toKey(relPath: string): string {
    return relPath.replaceAll('\\', '/');
}
