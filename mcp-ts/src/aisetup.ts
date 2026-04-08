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
import * as os   from 'node:os';
import { spawnSync } from 'node:child_process';
import { renderTemplate, FILE_VERSION_INFO, type TemplateContext } from './templates.js';

// ─── Public types ─────────────────────────────────────────────────────────────

export type AiTarget = 'claude' | 'copilot' | 'cursor' | 'agents';

export type SkillTemplate =
    | 'review'
    | 'brainstorm'
    | 'memory'
    | 'translate'
    | 'status'
    | 'continuity'
    | 'read_aloud'
    | 'read_in';

export const ALL_SKILLS: SkillTemplate[] = [
    'review', 'brainstorm', 'memory', 'translate', 'status', 'continuity', 'read_aloud', 'read_in',
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

/**
 * Bump this integer whenever templates change significantly enough that
 * existing users should regenerate their AI files.
 * Must be kept in sync with AI_SETUP_VERSION in vscode-ext/src/ai-setup.ts.
 */
export const AI_SETUP_VERSION = 7;

interface AiVersionEntry {
    version: number;
    label: string;
    zip: string | null;
}

export interface AiVersionFile {
    versions: Record<string, AiVersionEntry>;
}

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

    const versionFile = readAiVersionFile(root);
    const result: AiSetupResult = {
        regenerated: [],
        skipped: [],
        skillZipManifest: { rebuilt: [], created: [], skipped: [], failed: [] },
        versionStamp: versionFile,
    };

    for (const target of targets) {
        switch (target) {
            case 'claude':
                writeFile(root, 'CLAUDE.md', renderTemplate('claude', ctx), overwrite, versionFile, result);
                for (const skill of skills) {
                    const skillMd = path.join('.claude', 'skills', skill, 'SKILL.md');
                    writeFile(root, skillMd, renderTemplate(skill, ctx), overwrite, versionFile, result);
                }
                rebuildSkillZips(root, skills, result);
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

    stampAiVersion(root, versionFile);
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

function stampAiVersion(root: string, versionFile: AiVersionFile): void {
    const dir = path.join(root, '.bindery');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'ai-version.json'),
        JSON.stringify(versionFile, null, 2) + '\n',
        'utf-8'
    );
}

function rebuildSkillZips(root: string, skills: SkillTemplate[], result: AiSetupResult): void {
    for (const skill of skills) {
        const skillDir = path.join(root, '.claude', 'skills', skill);
        const skillMd = path.join(skillDir, 'SKILL.md');
        if (!fs.existsSync(skillMd)) { continue; }

        const zipRel = `.claude/skills/${skill}.zip`;
        const zipAbs = path.join(root, zipRel);

        const zipExists = fs.existsSync(zipAbs);
        const upToDate = zipExists
            && fs.statSync(zipAbs).mtimeMs >= fs.statSync(skillMd).mtimeMs;

        if (upToDate) {
            result.skillZipManifest.skipped.push(zipRel);
            continue;
        }

        if (!zipSkillFolder(root, skill, zipAbs)) {
            result.skillZipManifest.failed.push(zipRel);
            continue;
        }

        if (zipExists) {
            result.skillZipManifest.rebuilt.push(zipRel);
        } else {
            result.skillZipManifest.created.push(zipRel);
        }
    }
}

function toKey(relPath: string): string {
    return relPath.replaceAll('\\', '/');
}

function zipSkillFolder(root: string, skill: SkillTemplate, zipAbs: string): boolean {
    const skillsBase = path.join(root, '.claude', 'skills');
    fs.mkdirSync(skillsBase, { recursive: true });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-skillzip-'));
    const tmpZip = path.join(tmpDir, `${skill}.zip`);
    const zipFrom = skillsBase;

    let ok = false;

    if (process.platform === 'win32') {
        // Claude rejects archives whose internal entry names use backslashes.
        // pwsh Compress-Archive on the folder emits forward-slash entry names,
        // while Windows PowerShell may emit backslashes.
        const psScriptPath = path.join(tmpDir, 'compress-archive.ps1');
        fs.writeFileSync(
            psScriptPath,
            [
                'param(',
                '    [string]$Skill,',
                '    [string]$DestinationPath',
                ')',
                "Compress-Archive -LiteralPath $Skill -DestinationPath $DestinationPath -Force",
                ''
            ].join('\n'),
            'utf-8'
        );

        let zipped = spawnSync(
            'pwsh',
            ['-NoProfile', '-File', psScriptPath, skill, tmpZip],
            { cwd: zipFrom, encoding: 'utf-8' }
        );
        if (!zipped.error && zipped.status === 0) {
            ok = true;
        } else {
            zipped = spawnSync('zip', ['-r', tmpZip, skill], { cwd: zipFrom, encoding: 'utf-8' });
            if (!zipped.error && zipped.status === 0) {
                ok = true;
            }
        }
    } else {
        const zipped = spawnSync('zip', ['-r', tmpZip, skill], { cwd: zipFrom, encoding: 'utf-8' });
        if (!zipped.error && zipped.status === 0) {
            ok = true;
        }
    }

    if (!ok || !fs.existsSync(tmpZip)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        return false;
    }

    fs.mkdirSync(path.dirname(zipAbs), { recursive: true });
    const copyPath = zipAbs + '.tmp';
    fs.copyFileSync(tmpZip, copyPath);
    if (fs.existsSync(zipAbs)) {
        fs.unlinkSync(zipAbs);
    }
    fs.renameSync(copyPath, zipAbs);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return true;
}
