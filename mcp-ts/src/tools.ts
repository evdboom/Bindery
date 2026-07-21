/**
 * MCP tool implementations for Bindery.
 *
 * Each exported function corresponds to one MCP tool.
 * All functions receive `root: string` (resolved workspace root) plus
 * tool-specific arguments, and return a plain string (tool result content).
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { updateTypography }                 from './format.js';
import {
    buildIndex,
    buildSemanticIndex,
    fullSemanticSearch,
    indexPath,
    loadIndex,
    loadSemanticIndex,
    rerank,
    search,
    semanticIndexPath,
    semanticIndexStaleness,
    type SearchMode,
    type SearchResult,
} from './search.js';
import {
    setupAiFiles,
    writeBinderyCapabilitiesReadme,
    ALL_SKILLS,
    readAiVersionFile,
    expectedAiVersionEntries,
    type AiTarget,
    type SkillTemplate,
} from './aisetup.js';
import { probeTool, type ProbeResult } from './tool-probe.js';
import { BUILTIN_EN_GB_RULES, type TranslationRule } from './tools-dialect-defaults.js';
import { parseUnifiedDiff, formatReviewFiles } from './tools-diff.js';
import {
    getArcFolder,
    getArcGranularity,
    getCharactersFolder,
    getNotesFolder,
    getSessionFile,
    getPreferencesFile,
    getStoryFolder,
    type WorkspaceSettings,
} from '@bindery/core';

// Re-export so the VS Code extension can call this helper through the same
// `mcp-ts/out/tools` module it already loads for setup/health.
export { writeBinderyCapabilitiesReadme };
import {
    scanReviewMarkers,
    stripReviewMarkers,
    formatReviewMarkerFiles,
    type FormattedMarkerFile,
} from './tools-review-markers.js';

// ─── Shared helpers ───────────────────────────────────────────────────────────

function readJson<T>(filePath: string): T | null {
    if (!fs.existsSync(filePath)) { return null; }
    try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T; }
    catch { return null; }
}

interface Settings extends WorkspaceSettings {
    storyFolder?: string;
    notesFolder?: string;
    arcFolder?: string;
    charactersFolder?: string;
    sessionFile?: string;
    preferencesFile?: string;
    arcGranularity?: 'overall' | 'act' | 'chapter' | 'thread' | 'custom';
    author?: string;
    bookTitle?: string | Record<string, string>;
    languages?: Array<{ code: string; folderName: string; chapterWord: string; actPrefix: string; prologueLabel: string; epilogueLabel: string }>;
    aiTargets?: string[];
    aiSkills?: string[];
    git?: {
        snapshot?: {
            pushDefault?: boolean;
            remote?: string;
            branch?: string;
        };
    };
}

function readSettings(root: string): Settings | null {
    return readJson<Settings>(path.join(root, '.bindery', 'settings.json'));
}

function storyFolder(root: string): string {
    return getStoryFolder(readSettings(root));
}

const ALL_AI_TARGETS: AiTarget[] = ['claude', 'copilot', 'cursor', 'agents'];

function targetForFile(file: string): AiTarget {
    if (file === 'CLAUDE.md' || file.startsWith('.claude/')) { return 'claude'; }
    if (file.startsWith('.github/copilot')) { return 'copilot'; }
    if (file.startsWith('.cursor/')) { return 'cursor'; }
    return 'agents';
}

const SEARCH_MODES = new Set<SearchMode>(['lexical', 'semantic_rerank', 'full_semantic']);

function parseSearchMode(value: string | undefined): SearchMode {
    return SEARCH_MODES.has(value as SearchMode) ? value as SearchMode : 'lexical';
}

function semanticIndexEnabled(): boolean {
    return /^(1|true|yes|on)$/i.test(process.env['BINDERY_ENABLE_SEMANTIC_INDEX'] ?? '');
}

function appendWarnings(body: string, warnings: string[]): string {
    if (warnings.length === 0) { return body; }
    const header = warnings.map(w => 'Warning: ' + w).join('\n');
    return `${header}\n\n${body}`;
}

type GitExecResult = { stdout: string; stderr: string; status: number | null };

function runGit(root: string, args: string[]): GitExecResult {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
    if (result.error) { throw result.error; }
    return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        status: result.status ?? null,
    };
}

function gitOk(root: string, args: string[]): string {
    const result = runGit(root, args);
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
    }
    return result.stdout;
}

function gitTry(root: string, args: string[]): GitExecResult {
    try {
        return runGit(root, args);
    } catch (error) {
        return { stdout: '', stderr: error instanceof Error ? error.message : String(error), status: 1 };
    }
}

function trimOrUndefined(value: string | undefined): string | undefined {
    return value?.trim() || undefined;
}

function listGitRemotes(root: string): string[] {
    const result = gitTry(root, ['remote']);
    if (result.status !== 0) { return []; }
    return result.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function pickRemote(root: string, preferred?: string): string | undefined {
    const remotes = listGitRemotes(root);
    if (preferred && remotes.includes(preferred)) { return preferred; }
    return remotes.includes('origin') ? 'origin' : remotes[0];
}

function currentBranch(root: string): string | undefined {
    const result = gitTry(root, ['branch', '--show-current']);
    const branch = result.stdout.trim();
    return result.status === 0 && branch ? branch : undefined;
}

function currentUpstream(root: string): string | undefined {
    const result = gitTry(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    const upstream = result.stdout.trim();
    return result.status === 0 && upstream ? upstream : undefined;
}

function remoteDefaultBranch(root: string, remote: string): string | undefined {
    const symbolic = gitTry(root, ['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`]);
    if (symbolic.status === 0) {
        const ref = symbolic.stdout.trim();
        const prefix = `refs/remotes/${remote}/`;
        if (ref.startsWith(prefix)) {
            return ref.slice(prefix.length);
        }
    }

    const remoteShow = gitTry(root, ['remote', 'show', remote]);
    if (remoteShow.status === 0) {
        const match = /^\s*HEAD branch:\s+(.+)$/m.exec(remoteShow.stdout);
        if (match?.[1]?.trim()) {
            return match[1].trim();
        }
    }

    return undefined;
}

function localBranchExists(root: string, branch: string): boolean {
    return gitTry(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0;
}

function remoteBranchExists(root: string, remote: string, branch: string): boolean {
    const result = gitTry(root, ['ls-remote', '--heads', remote, branch]);
    return result.status === 0 && result.stdout.trim().length > 0;
}

function dirtyWorktree(root: string): boolean {
    const result = gitTry(root, ['status', '--porcelain']);
    return result.status === 0 && result.stdout.trim().length > 0;
}

function settingsPath(root: string): string {
    return path.join(root, '.bindery', 'settings.json');
}

type UpdateSettingsObjectResult = 'updated' | 'missing' | 'invalid';

function updateSettingsObject(root: string, patch: Record<string, unknown>): UpdateSettingsObjectResult {
    const filePath = settingsPath(root);
    if (!fs.existsSync(filePath)) { return 'missing'; }

    let existing: Record<string, unknown> = {};
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
        if (!isPlainObject(parsed)) { return 'invalid'; }
        existing = parsed;
    } catch {
        return 'invalid';
    }

    const merged = deepMergeSettings(existing, patch);
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
    return 'updated';
}

function ensureGitRepository(root: string): string | undefined {
    try {
        gitOk(root, ['rev-parse', '--show-toplevel']);
        return undefined;
    } catch {
        return 'Failed to update workspace: not a git repository.';
    }
}

function fetchWorkspaceRemote(root: string, remote: string): string {
    gitOk(root, ['fetch', remote, '--prune']);
    return `Fetched latest refs from ${remote}.`;
}

type SwitchBranchResult = {
    activeBranch?: string;
    note?: string;
    error?: string;
};

function maybeSwitchWorkspaceBranch(
    root: string,
    remote: string,
    activeBranch: string,
    requestedBranch: string | undefined,
    switchBranch: boolean | undefined,
): SwitchBranchResult {
    if (!requestedBranch || requestedBranch === activeBranch) {
        return { activeBranch };
    }

    if (switchBranch !== true) {
        return {
            activeBranch,
            note: `Current branch is ${activeBranch}. Requested branch ${requestedBranch} was not checked out because switchBranch is false.`,
        };
    }

    try {
        if (localBranchExists(root, requestedBranch)) {
            gitOk(root, ['switch', requestedBranch]);
        } else if (remoteBranchExists(root, remote, requestedBranch)) {
            gitOk(root, ['switch', '--track', `${remote}/${requestedBranch}`]);
        } else {
            return { error: `Failed to update workspace: branch ${requestedBranch} was not found locally or on ${remote}.` };
        }

        return {
            activeBranch: currentBranch(root) ?? requestedBranch,
            note: `Switched to ${requestedBranch}.`,
        };
    } catch (error) {
        return { error: `Failed to update workspace: ${error instanceof Error ? error.message : String(error)}` };
    }
}

function ensureWorkspaceUpstream(root: string, remote: string, branch: string, defaultBranch?: string): string | undefined {
    const upstreamBefore = currentUpstream(root);
    if (!upstreamBefore && remoteBranchExists(root, remote, branch)) {
        const setUpstream = gitTry(root, ['branch', '--set-upstream-to', `${remote}/${branch}`, branch]);
        if (setUpstream.status === 0) {
            return `Set upstream to ${remote}/${branch}.`;
        }
    }

    if (currentUpstream(root)) {
        return undefined;
    }

    const branchNote = defaultBranch && branch !== defaultBranch
        ? ` Current branch ${branch} differs from remote default ${defaultBranch}.`
        : '';
    return `Failed to update workspace: branch ${branch} has no upstream tracking branch.${branchNote}`;
}

type StashState = { stashed: boolean; note?: string };

function stashWorkspaceChanges(root: string, autoStash: boolean): StashState {
    if (!autoStash || !dirtyWorktree(root)) {
        return { stashed: false };
    }

    const stamp = new Date().toISOString();
    const stashResult = gitTry(root, ['stash', 'push', '--include-untracked', '-m', `bindery update_workspace ${stamp}`]);
    if (stashResult.status !== 0) {
        return { stashed: false };
    }

    const stdout = stashResult.stdout.trim();
    if (/^No local changes to save/i.test(stdout)) {
        return { stashed: false };
    }

    return { stashed: true, note: stdout || 'Stashed local changes before pulling.' };
}

function restoreWorkspaceStash(root: string, failurePrefix?: string): string {
    const popResult = gitTry(root, ['stash', 'pop']);
    if (popResult.status === 0) {
        return popResult.stdout.trim() || 'Restored stashed local changes.';
    }

    const detail = popResult.stderr.trim() || popResult.stdout.trim() || 'stash pop failed';
    return `${failurePrefix ?? 'Restoring stashed changes needs attention'}: ${detail}`;
}

function workspaceBranchStatus(branch: string, remote: string, defaultBranch?: string): string {
    if (defaultBranch) {
        return branch === defaultBranch
            ? `Current branch ${branch} matches the remote default branch.`
            : `Current branch ${branch} differs from remote default branch ${defaultBranch}.`;
    }

    return `Current branch ${branch}. Remote default branch for ${remote} could not be determined.`;
}

type PullWorkspaceResult = {
    error?: string;
    lines: string[];
};

function pullWorkspace(root: string, stashState: StashState): PullWorkspaceResult {
    const pullResult = gitTry(root, ['pull', '--ff-only']);
    if (pullResult.status !== 0) {
        const restoreNotes = stashState.stashed
            ? [restoreWorkspaceStash(root, 'Pull failed and stash restore needs attention')]
            : [];
        const detail = pullResult.stderr.trim() || pullResult.stdout.trim() || 'git pull failed';
        return { error: ['Failed to update workspace: ' + detail, ...restoreNotes].join('\n'), lines: [] };
    }

    const lines = [pullResult.stdout.trim() || 'Workspace is already up to date.'];
    if (stashState.stashed) {
        lines.push(restoreWorkspaceStash(root, 'Pulled successfully, but restoring stashed changes needs attention'));
    }
    return { lines };
}

function switchBranchReminder(requestedBranch: string | undefined, activeBranch: string, switchBranch: boolean | undefined): string | undefined {
    if (!requestedBranch || requestedBranch === activeBranch || switchBranch === true) {
        return undefined;
    }
    return `If you want to switch to ${requestedBranch}, call update_workspace again with switchBranch: true.`;
}

function maybeRememberSnapshotDefaults(
    root: string,
    rememberPushDefaults: boolean | undefined,
    pushRequested: boolean,
    remote: string | undefined,
    branch: string | undefined,
): string | undefined {
    if (!rememberPushDefaults) {
        return undefined;
    }

    const snapshot: Record<string, unknown> = { pushDefault: pushRequested };
    if (remote) { snapshot.remote = remote; }
    if (branch) { snapshot.branch = branch; }

    const result = updateSettingsObject(root, {
        git: {
            snapshot,
        },
    });

    if (result === 'updated') {
        return 'Saved snapshot push defaults to .bindery/settings.json.';
    }
    if (result === 'missing') {
        return 'Could not save snapshot push defaults: .bindery/settings.json was not found.';
    }
    return 'Could not save snapshot push defaults: .bindery/settings.json is invalid JSON.';
}

function pushSnapshot(root: string, remote: string | undefined, branch: string | undefined): string {
    if (!remote) {
        return 'Push skipped: no git remote is configured.';
    }

    if (!branch) {
        return 'Push skipped: unable to determine which branch to push.';
    }

    const pushResult = gitTry(root, ['push', remote, branch]);
    if (pushResult.status !== 0) {
        return `Push failed: ${pushResult.stderr.trim() || pushResult.stdout.trim() || 'git push failed'}`;
    }

    return `Pushed snapshot to ${remote}/${branch}.`;
}

// ─── health ───────────────────────────────────────────────────────────────────

interface SemanticStatus { status: string; staleReasons: string[] }

function getSemanticStatus(root: string): SemanticStatus {
    const semanticPath = semanticIndexPath(root);
    if (!fs.existsSync(semanticPath)) {
        return { status: 'not built', staleReasons: [] };
    }
    const semanticIndex = loadSemanticIndex(root);
    if (!semanticIndex) {
        return { status: 'present but unreadable', staleReasons: [] };
    }
    const { meta } = semanticIndex;
    const status = `present (chunks=${meta.chunkCount}, vectors=${meta.vectorCount}, model=${meta.model}, built=${meta.builtAt})`;
    const stale = semanticIndexStaleness(root, semanticIndex);
    return { status, staleReasons: stale.isStale ? stale.reasons : [] };
}

type OutdatedEntry = { file: string; label: string; expected: number; found: number };

function getOutdatedAiFiles(root: string, enabledTargets: Set<string>): OutdatedEntry[] {
    const installed = readAiVersionFile(root);
    const expected = expectedAiVersionEntries();
    const outdated: OutdatedEntry[] = [];
    for (const [file, exp] of Object.entries(expected)) {
        if (!enabledTargets.has(targetForFile(file))) { continue; }
        if (!fs.existsSync(path.join(root, file))) { continue; }
        const found = installed.versions[file]?.version ?? 0;
        if (found < exp.version) {
            outdated.push({ file, label: exp.label, expected: exp.version, found });
        }
    }
    return outdated;
}

export function toolHealth(root: string): string {
    const settingsPath = path.join(root, '.bindery', 'settings.json');
    const settingsStatus = fs.existsSync(settingsPath)
        ? 'present'
        : 'missing — run init_workspace to set up this book';

    const memDir   = path.join(root, '.bindery', 'memories');
    const memFiles = fs.existsSync(memDir)
        ? fs.readdirSync(memDir).filter(f => f.endsWith('.md')).length
        : -1;
    const memFileSuffix = memFiles === 1 ? '' : 's';
    const memoriesStatus = memFiles >= 0
        ? `present (${memFiles} file${memFileSuffix})`
        : 'not created yet';

    const idxPath = indexPath(root);
    let indexStatus = 'not built — run index_build first';
    if (fs.existsSync(idxPath)) {
        const raw = readJson<{ meta?: { builtAt?: string; chunkCount?: number; contentSignature?: string } }>(idxPath);
        indexStatus = `present (chunks=${raw?.meta?.chunkCount ?? '?'}, built=${raw?.meta?.builtAt ?? '?'})`;
    }

    const { status: semanticIndexStatus, staleReasons: semanticIndexStale } = getSemanticStatus(root);

    const ollamaUrl = process.env['BINDERY_OLLAMA_URL'];
    const embeddingsStatus = ollamaUrl
        ? `ollama at ${ollamaUrl}`
        : 'BM25 only (set BINDERY_OLLAMA_URL for reranking)';

    const healthSettings = readSettings(root);
    const validTargets = healthSettings?.aiTargets?.filter(t => ALL_AI_TARGETS.includes(t as AiTarget));
    const enabledTargets = new Set<string>(validTargets ?? ALL_AI_TARGETS);
    const aiVersionsOutdated = getOutdatedAiFiles(root, enabledTargets);

    const tools = {
        git:         summarizeProbe(probeTool('git')),
        pandoc:      summarizeProbe(probeTool('pandoc')),
        libreoffice: summarizeProbe(probeTool('libreoffice')),
    };

    const response = {
        root,
        settings: settingsStatus,
        memories: memoriesStatus,
        index: indexStatus,
        semantic_index: semanticIndexStatus,
        semantic_index_enabled: semanticIndexEnabled(),
        semantic_index_stale: semanticIndexStale.length > 0,
        semantic_index_stale_reasons: semanticIndexStale,
        embeddings: embeddingsStatus,
        default_search_mode: parseSearchMode(process.env['BINDERY_DEFAULT_SEARCH_MODE']),
        tools,
        ai_version_outdated: aiVersionsOutdated.length > 0,
        ai_versions_outdated: aiVersionsOutdated,
        message: aiVersionsOutdated.length > 0
            ? 'AI instruction files are out of date. Run setup_ai_files to regenerate them. If you use Claude Desktop skills, re-upload updated SKILL.md files.'
            : 'AI instruction files are up to date.',
    };

    return JSON.stringify(response, null, 2);
}

function summarizeProbe(p: ProbeResult): { available: boolean; path: string | null; version: string | null } {
    return { available: p.available, path: p.path, version: p.version };
}

// ─── index_build ─────────────────────────────────────────────────────────────

export async function toolIndexBuild(root: string): Promise<string> {
    const { meta } = buildIndex(root);
    const lines = [
        `Lexical index built: ${meta.chunkCount} chunks, ${new Date(meta.builtAt).toLocaleString()}`,
    ];

    if (!semanticIndexEnabled()) {
        lines.push('Semantic index skipped: disabled (set BINDERY_ENABLE_SEMANTIC_INDEX=true to build it).');
        return lines.join('\n');
    }

    if (!process.env['BINDERY_OLLAMA_URL']) {
        lines.push('Semantic index skipped: BINDERY_OLLAMA_URL is not configured.');
        return lines.join('\n');
    }

    try {
        // Log progress to stderr at coarse milestones so agents / humans get feedback on long builds.
        // stderr keeps stdout clean (MCP servers use stdout for JSON-RPC).
        let lastLoggedPct = -10;
        const semantic = await buildSemanticIndex(root, {
            onProgress: ({ completed, total, failed }) => {
                if (total === 0) { return; }
                const pct = Math.floor((completed / total) * 100);
                if (pct >= lastLoggedPct + 10 || completed === total) {
                    const failedCount = failed ? `, ${failed} failed` : '';
                    lastLoggedPct = pct;
                    process.stderr.write(`[bindery] semantic index: ${completed}/${total} (${pct}%${failedCount})\n`);
                }
            },
        });
        lines.push(
            `Semantic index built: ${semantic.meta.vectorCount}/${semantic.meta.chunkCount} vectors, ` +
            `${new Date(semantic.meta.builtAt).toLocaleString()} (${semantic.meta.model})`
        );
    } catch (e) {
        lines.push(`Semantic index failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    return lines.join('\n');
}

// ─── index_status ─────────────────────────────────────────────────────────────

export function toolIndexStatus(root: string): string {
    const lines: string[] = [];

    const lexicalPath = indexPath(root);
    if (fs.existsSync(lexicalPath)) {
        const raw = readJson<{ meta?: { builtAt?: string; chunkCount?: number; root?: string; contentSignature?: string } }>(lexicalPath);
        if (raw?.meta) {
            lines.push(
                `lexical chunks: ${raw.meta.chunkCount ?? '?'}`,
                `lexical built:  ${raw.meta.builtAt ?? '?'}`,
                `lexical root:   ${raw.meta.root ?? '?'}`,
            );
        } else {
            lines.push('lexical: present but metadata is unreadable');
        }
    } else {
        lines.push('lexical: not built — run index_build first');
    }

    const semantic = loadSemanticIndex(root);
    if (semantic) {
        const stale = semanticIndexStaleness(root, semantic);
        lines.push(
            `semantic chunks: ${semantic.meta.chunkCount}`,
            `semantic vectors: ${semantic.meta.vectorCount}`,
            `semantic built:   ${semantic.meta.builtAt}`,
            `semantic model:   ${semantic.meta.model}`,
            `semantic stale:   ${stale.isStale ? 'yes' : 'no'}`,
        );
        if (stale.reasons.length > 0) {
            lines.push(`semantic why:     ${stale.reasons.join('; ')}`);
        }
    } else {
        lines.push('semantic: not built');
    }

    lines.push(
        `default mode:     ${parseSearchMode(process.env['BINDERY_DEFAULT_SEARCH_MODE'])}`,
        `semantic enabled: ${semanticIndexEnabled() ? 'yes' : 'no'}`,
    );
    return lines.join('\n');
}

// ─── get_text ─────────────────────────────────────────────────────────────────

export interface GetTextArgs {
    identifier: string;
    startLine?: number;
    endLine?:   number;
}

export function toolGetText(root: string, args: GetTextArgs): string {
    const resolvedRoot = path.resolve(root);

    // Try as relative path first, then search in story folder
    const candidates = [
        path.resolve(root, args.identifier),
        path.resolve(root, storyFolder(root), args.identifier),
    ];

    let filePath: string | null = null;
    for (const c of candidates) {
        const rel = path.relative(resolvedRoot, c);
        if (rel.startsWith('..') || path.isAbsolute(rel)) { continue; }
        if (fs.existsSync(c) && fs.statSync(c).isFile()) { filePath = c; break; }
    }

    if (!filePath) {
        return `File not found: ${args.identifier}`;
    }

    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
    const start = (args.startLine ?? 1) - 1;
    const end   = args.endLine ?? lines.length;
    return lines.slice(start, end).join('\n');
}

// ─── get_chapter ─────────────────────────────────────────────────────────────

export interface GetChapterArgs {
    chapterNumber: number;
    language:      string;
}

export function toolGetChapter(root: string, args: GetChapterArgs): string {
    const story    = storyFolder(root);
    const langDir  = path.join(root, story, args.language.toUpperCase());

    if (!fs.existsSync(langDir)) {
        return `Language folder not found: ${args.language.toUpperCase()}`;
    }

    // Search recursively for a file whose name contains the chapter number
    const file = findChapterFile(langDir, args.chapterNumber);
    if (!file) {
        return `Chapter ${args.chapterNumber} not found in ${args.language.toUpperCase()}`;
    }

    return fs.readFileSync(file, 'utf-8');
}

// ─── get_book_until ─────────────────────────────────────────────────────────

export interface GetBookUntilArgs {
    chapterNumber: number;
    language: string;
    startChapter?: number;
}

export function toolGetBookUntil(root: string, args: GetBookUntilArgs): string {
    const story = storyFolder(root);
    const lang = args.language.toUpperCase();
    const langDir = path.join(root, story, lang);
    if (!fs.existsSync(langDir)) {
        return `Language folder not found: ${lang}`;
    }

    const start = Math.max(1, Math.floor(args.startChapter ?? 1));
    const end = Math.max(1, Math.floor(args.chapterNumber));
    if (start > end) {
        return `Invalid range: startChapter (${start}) is greater than chapterNumber (${end}).`;
    }

    const chapterFileMap = findChapterFiles(langDir);
    const sections: string[] = [];
    for (let i = start; i <= end; i++) {
        const file = chapterFileMap.get(i);
        if (!file) {
            return `Chapter ${i} not found in ${lang}`;
        }
        const content = fs.readFileSync(file, 'utf-8');
        sections.push(`<!-- BEGIN CHAPTER ${i} -->\n${content}\n<!-- END CHAPTER ${i} -->`);
    }

    return sections.join('\n\n---\n\n');
}

function findChapterFile(dir: string, num: number): string | null {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const found = findChapterFile(fullPath, num);
            if (found) { return found; }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const m = /(?:chapter|hoofdstuk|chapter_?)\s*(\d+)/i.exec(entry.name);
            if (m && Number.parseInt(m[1], 10) === num) { return fullPath; }
        }
    }
    return null;
}

function findChapterFiles(dir: string, acc = new Map<number, string>()): Map<number, string> {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            findChapterFiles(fullPath, acc);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const m = /(?:chapter|hoofdstuk|chapter_?)\s*(\d+)/i.exec(entry.name);
            if (m) {
                const chapterNumber = Number.parseInt(m[1], 10);
                if (!acc.has(chapterNumber)) {
                    acc.set(chapterNumber, fullPath);
                }
            }
        }
    }
    return acc;
}

// ─── get_overview ─────────────────────────────────────────────────────────────

export interface GetOverviewArgs {
    language?: string;
    act?:      number;
}

export function toolGetOverview(root: string, args: GetOverviewArgs): string {
    const story  = storyFolder(root);
    const langs  = args.language && args.language !== 'ALL'
        ? [args.language.toUpperCase()]
        : detectLangFolders(root, story);

    const lines: string[] = [];

    for (const lang of langs) {
        const langDir = path.join(root, story, lang);
        if (!fs.existsSync(langDir)) { continue; }
        lines.push(`## ${lang}`, ...overviewForLang(langDir, args.act), '');
    }

    return lines.join('\n') || 'No language folders found.';
}

function actLines(langDir: string, actEntry: { name: string }): string[] {
    const actDir = path.join(langDir, actEntry.name);
    const chapters = fs.readdirSync(actDir, { withFileTypes: true })
        .filter(e => e.isFile() && e.name.endsWith('.md'))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const numbers = chapters
        .map(ch => {
            const m = /(\d+)/.exec(ch.name);
            return m ? Number.parseInt(m[1], 10) : null;
        })
        .filter((n): n is number => n !== null);
    const gaps = findNumericGaps(numbers);
    const lines = [
        `### ${actEntry.name}`,
        ...chapters.map(ch => {
            const firstLine = firstH1(path.join(actDir, ch.name));
            return `- ${ch.name}${firstLine ? ': ' + firstLine : ''}`;
        }),
    ];
    if (gaps.length > 0) {
        lines.push(`_Warning: non-contiguous chapter numbering, missing: ${gaps.join(', ')}_`);
    }
    return lines;
}

/** Returns the list of integers missing from the range [min..max] of `nums`. */
function findNumericGaps(nums: number[]): number[] {
    if (nums.length < 2) { return []; }
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const present = new Set(nums);
    const gaps: number[] = [];
    for (let i = min; i <= max; i++) {
        if (!present.has(i)) { gaps.push(i); }
    }
    return gaps;
}

function topLevelLines(langDir: string): string[] {
    const topLevel = fs.readdirSync(langDir, { withFileTypes: true })
        .filter(e => e.isFile() && e.name.endsWith('.md'));
    if (topLevel.length === 0) { return []; }
    return [
        '### Top-level',
        ...topLevel.map(f => {
            const firstLine = firstH1(path.join(langDir, f.name));
            return `- ${f.name}${firstLine ? ': ' + firstLine : ''}`;
        }),
    ];
}

function overviewForLang(langDir: string, actFilter?: number): string[] {
    const lines: string[] = [];
    const entries = fs.readdirSync(langDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name));

    for (const actEntry of entries) {
        const actNum = parseActNumber(actEntry.name);
        if (actFilter !== undefined && actNum !== null && actNum !== actFilter) { continue; }
        lines.push(...actLines(langDir, actEntry));
    }

    if (actFilter === undefined) {
        lines.push(...topLevelLines(langDir));
    }

    return lines;
}

function firstH1(filePath: string): string | null {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const m = /^#\s+(.+)/m.exec(content);
        return m ? m[1].trim() : null;
    } catch { return null; }
}

function parseActNumber(name: string): number | null {
    const roman: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 };
    const m = /\b(I{1,3}|IV|V)\b/.exec(name);
    return m ? roman[m[1]] ?? null : null;
}

function detectLangFolders(root: string, storyFolderName: string): string[] {
    const storyPath = path.join(root, storyFolderName);
    if (!fs.existsSync(storyPath)) { return []; }
    return fs.readdirSync(storyPath, { withFileTypes: true })
        .filter(e => e.isDirectory() && /^[A-Z]{2,3}$/i.test(e.name))
        .map(e => e.name.toUpperCase());
}

// ─── get_notes ────────────────────────────────────────────────────────────────

export interface GetNotesArgs {
    category?: string;
    name?:     string;
}

export interface NoteListArgs {
    category?: string;
}

export interface NoteGetArgs {
    path: string;
}

export interface NoteCreateArgs {
    path: string;
    title?: string;
    content?: string;
    overwrite?: boolean;
}

export interface NoteAppendArgs {
    path: string;
    content: string;
    heading?: string;
}

export interface CharacterListArgs {
    name?: string;
}

export interface CharacterGetArgs {
    name: string;
}

export interface CharacterCreateArgs {
    name: string;
    role?: string;
    age?: string;
    origin?: string;
    skills?: string;
    strengths?: string;
    weaknesses?: string;
    personality?: string;
    background?: string;
    narrativeArc?: string;
    appearanceNotes?: string;
    relationships?: string;
    firstAppearance?: string;
    openQuestions?: string;
    continuityNotes?: string;
    indexNotes?: string;
    overwrite?: boolean;
}

export interface CharacterUpdateArgs extends CharacterCreateArgs {
    overwrite?: boolean;
}

export interface ArcListArgs {
    kind?: string;
}

export interface ArcGetArgs {
    path: string;
}

export interface ArcCreateArgs {
    path: string;
    title?: string;
    kind?: string;
    purpose?: string;
    majorBeats?: string;
    characterMovement?: string;
    worldImplications?: string;
    unresolvedQuestions?: string;
    continuityRisks?: string;
    linkedChapters?: string;
    overwrite?: boolean;
}

export interface ArcUpdateArgs extends ArcCreateArgs {}

function extractNamedSections(content: string, nameFilter: string): string[] {
    const lowerFilter = nameFilter.toLowerCase();
    return content.split(/^#{1,3}\s+/m)
        .filter(section => section.toLowerCase().includes(lowerFilter))
        .map(section => section.trim());
}

export function toolGetNotes(root: string, args: GetNotesArgs): string {
    const notesDir = notesRoot(root);
    const candidates: string[] = [];

    if (fs.existsSync(notesDir)) {
        collectAllMd(notesDir, candidates);
    }

    if (candidates.length === 0) { return 'No notes files found.'; }

    const catFilter  = args.category?.toLowerCase();
    const nameFilter = args.name?.toLowerCase();
    const results: string[] = [];

    for (const filePath of candidates) {
        const relName = path.basename(filePath, '.md').toLowerCase();
        if (catFilter && !relName.includes(catFilter)) { continue; }
        const content = fs.readFileSync(filePath, 'utf-8');
        if (nameFilter) {
            results.push(...extractNamedSections(content, nameFilter));
        } else {
            results.push(`## ${path.basename(filePath)}\n\n${content}`);
        }
    }

    return results.join('\n\n---\n\n') || 'No matching notes found.';
}

export function toolNoteList(root: string, args: NoteListArgs): string {
    const baseDir = notesRoot(root);
    const listDir = args.category ? safeNoteDir(root, args.category) : baseDir;
    if (!listDir) { return `Invalid note category: ${args.category}`; }
    if (!fs.existsSync(listDir)) { return args.category ? `Note category not found: ${args.category}` : 'No notes folder found.'; }

    const files: string[] = [];
    collectAllMd(listDir, files);
    if (files.length === 0) { return args.category ? `No notes found in category: ${args.category}` : 'No notes found.'; }

    return files
        .sort((a, b) => path.relative(baseDir, a).localeCompare(path.relative(baseDir, b), undefined, { numeric: true }))
        .map(filePath => {
            const rel = normalizeSlashes(path.relative(baseDir, filePath));
            const title = firstH1(filePath);
            const lineCount = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).length;
            return `- ${rel}${title ? ` — ${title}` : ''} (${lineCount} lines)`;
        })
        .join('\n');
}

export function toolNoteGet(root: string, args: NoteGetArgs): string {
    const filePath = safeNoteFile(root, args.path);
    if (!filePath) { return `Invalid note path: ${args.path}`; }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) { return `Note not found: ${normalizeNotePath(args.path)}`; }
    return fs.readFileSync(filePath, 'utf-8');
}

export function toolNoteCreate(root: string, args: NoteCreateArgs): string {
    const filePath = safeNoteFile(root, args.path);
    if (!filePath) { return `Invalid note path: ${args.path}`; }
    const rel = normalizeNotePath(args.path);
    if (fs.existsSync(filePath) && !args.overwrite) {
        return `Note already exists: ${rel}. Pass overwrite: true to replace it.`;
    }

    const title = (args.title ?? titleFromNotePath(rel)).trim();
    const body = (args.content ?? '').trim();
    const content = `# ${title}\n${body ? `\n${body}\n` : '\n'}`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return `${fs.existsSync(filePath) && args.overwrite ? 'Wrote' : 'Created'} note: ${rel}`;
}

export function toolNoteAppend(root: string, args: NoteAppendArgs): string {
    const filePath = safeNoteFile(root, args.path);
    if (!filePath) { return `Invalid note path: ${args.path}`; }
    const rel = normalizeNotePath(args.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const existed = fs.existsSync(filePath);
    if (!existed) {
        fs.writeFileSync(filePath, `# ${titleFromNotePath(rel)}\n`, 'utf-8');
    }

    const heading = args.heading?.trim();
    const addition = `${heading ? `\n## ${heading}\n` : '\n'}${args.content.trim()}\n`;
    fs.appendFileSync(filePath, addition, 'utf-8');

    const lineCount = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).length;
    return `${existed ? 'Appended to' : 'Created and appended to'} note: ${rel} (${lineCount} lines).`;
}

function notesRoot(root: string): string {
    return path.join(root, getNotesFolder(readSettings(root) ?? null));
}

function safeNoteDir(root: string, noteDir: string): string | null {
    const baseDir = notesRoot(root);
    const resolved = path.resolve(baseDir, noteDir);
    const rel = path.relative(baseDir, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) { return null; }
    return resolved;
}

function safeNoteFile(root: string, notePath: string): string | null {
    const baseDir = notesRoot(root);
    const normalized = normalizeNotePath(notePath);
    const resolved = path.resolve(baseDir, normalized);
    const rel = path.relative(baseDir, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) { return null; }
    return resolved;
}

function normalizeNotePath(notePath: string): string {
    const normalized = notePath.replace(/\\/g, '/').replace(/^\/+/, '');
    return normalized.toLowerCase().endsWith('.md') ? normalized : `${normalized}.md`;
}

function normalizeSlashes(value: string): string {
    return value.replace(/\\/g, '/');
}

function titleFromNotePath(notePath: string): string {
    const base = path.basename(notePath, '.md');
    return base
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, c => c.toUpperCase()) || 'Untitled Note';
}

function collectAllMd(dir: string, out: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) { collectAllMd(fullPath, out); }
        else if (entry.isFile() && entry.name.endsWith('.md')) { out.push(fullPath); }
    }
}

// ─── character_list / character_get / character_create / character_update ───

type CharacterProfile = {
    name: string;
    role?: string;
    age?: string;
    origin?: string;
    skills?: string;
    strengths?: string;
    weaknesses?: string;
    personality?: string;
    background?: string;
    narrativeArc?: string;
    appearanceNotes?: string;
    relationships?: string;
    firstAppearance?: string;
    openQuestions?: string;
    continuityNotes?: string;
    indexNotes?: string;
};

const CHARACTER_SECTION_FIELDS: Array<[keyof CharacterProfile, string]> = [
    ['personality', 'Personality'],
    ['background', 'Background'],
    ['narrativeArc', 'Narrative Arc'],
    ['appearanceNotes', 'Appearance Notes'],
    ['relationships', 'Relationships'],
    ['openQuestions', 'Open Questions'],
    ['continuityNotes', 'Continuity Notes'],
];

export function toolCharacterList(root: string, args: CharacterListArgs = {}): string {
    const baseDir = charactersRoot(root);
    if (!fs.existsSync(baseDir)) { return 'No character folder found.'; }

    const files: string[] = [];
    collectAllMd(baseDir, files);
    const filter = args.name?.trim().toLowerCase();
    const rows = files
        .filter(filePath => path.basename(filePath).toLowerCase() !== 'index.md')
        .map(filePath => ({ filePath, profile: parseCharacterProfile(fs.readFileSync(filePath, 'utf-8'), titleFromNotePath(filePath)) }))
        .filter(({ filePath, profile }) => !filter || profile.name.toLowerCase().includes(filter) || path.basename(filePath).toLowerCase().includes(filter))
        .sort((a, b) => a.profile.name.localeCompare(b.profile.name))
        .map(({ filePath, profile }) => {
            const rel = normalizeSlashes(path.relative(baseDir, filePath));
            const details = [profile.role, profile.firstAppearance].filter(Boolean).join(' — ');
            return `- ${profile.name} (${rel})${details ? ` — ${details}` : ''}`;
        });

    return rows.join('\n') || (filter ? `No characters matched: ${args.name}` : 'No character profiles found.');
}

export function toolCharacterGet(root: string, args: CharacterGetArgs): string {
    const filePath = findCharacterFile(root, args.name);
    if (!filePath) { return `Character not found: ${args.name}`; }
    return fs.readFileSync(filePath, 'utf-8');
}

export function toolCharacterCreate(root: string, args: CharacterCreateArgs): string {
    const name = args.name.trim();
    if (!name) { return 'Character name is required.'; }

    const baseDir = charactersRoot(root);
    const filePath = characterFilePath(root, name);
    const rel = normalizeSlashes(path.relative(baseDir, filePath));
    if (fs.existsSync(filePath) && !args.overwrite) {
        return `Character already exists: ${name} (${rel}). Pass overwrite: true to replace it.`;
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const profile = characterProfileFromArgs(args);
    fs.writeFileSync(filePath, renderCharacterProfile(profile), 'utf-8');
    updateCharacterIndex(root, profile, rel);
    return `${fs.existsSync(filePath) && args.overwrite ? 'Wrote' : 'Created'} character: ${name} (${rel})`;
}

export function toolCharacterUpdate(root: string, args: CharacterUpdateArgs): string {
    const filePath = findCharacterFile(root, args.name);
    if (!filePath) { return `Character not found: ${args.name}. Use character_create first.`; }

    const existing = parseCharacterProfile(fs.readFileSync(filePath, 'utf-8'), args.name);
    const updated = mergeDefined(existing, characterProfileFromArgs(args));
    fs.writeFileSync(filePath, renderCharacterProfile(updated), 'utf-8');
    updateCharacterIndex(root, updated, normalizeSlashes(path.relative(charactersRoot(root), filePath)));
    return `Updated character: ${updated.name} (${normalizeSlashes(path.relative(charactersRoot(root), filePath))})`;
}

function charactersRoot(root: string): string {
    return path.join(root, getCharactersFolder(readSettings(root) ?? null));
}

function characterSlug(name: string): string {
    return name.trim()
        .toLowerCase()
        .replace(/['"`]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'character';
}

function characterFilePath(root: string, name: string): string {
    return path.join(charactersRoot(root), `${characterSlug(name)}.md`);
}

function findCharacterFile(root: string, name: string): string | null {
    const baseDir = charactersRoot(root);
    if (!fs.existsSync(baseDir)) { return null; }
    const slug = characterSlug(name);
    const direct = path.join(baseDir, `${slug}.md`);
    if (fs.existsSync(direct)) { return direct; }

    const files: string[] = [];
    collectAllMd(baseDir, files);
    const lowerName = name.trim().toLowerCase();
    return files.find(filePath => {
        if (path.basename(filePath).toLowerCase() === 'index.md') { return false; }
        const profile = parseCharacterProfile(fs.readFileSync(filePath, 'utf-8'), path.basename(filePath, '.md'));
        return profile.name.toLowerCase() === lowerName || path.basename(filePath, '.md').toLowerCase() === slug;
    }) ?? null;
}

function characterProfileFromArgs(args: CharacterCreateArgs): CharacterProfile {
    return {
        name: args.name.trim(),
        role: trimOrUndefined(args.role),
        age: trimOrUndefined(args.age),
        origin: trimOrUndefined(args.origin),
        skills: trimOrUndefined(args.skills),
        strengths: trimOrUndefined(args.strengths),
        weaknesses: trimOrUndefined(args.weaknesses),
        personality: trimOrUndefined(args.personality),
        background: trimOrUndefined(args.background),
        narrativeArc: trimOrUndefined(args.narrativeArc),
        appearanceNotes: trimOrUndefined(args.appearanceNotes),
        relationships: trimOrUndefined(args.relationships),
        firstAppearance: trimOrUndefined(args.firstAppearance),
        openQuestions: trimOrUndefined(args.openQuestions),
        continuityNotes: trimOrUndefined(args.continuityNotes),
        indexNotes: trimOrUndefined(args.indexNotes),
    };
}

function renderCharacterProfile(profile: CharacterProfile): string {
    const tableRows = [
        ['Role', profile.role],
        ['Age', profile.age],
        ['Origin', profile.origin],
        ['Skills', profile.skills],
        ['Strengths', profile.strengths],
        ['Weaknesses', profile.weaknesses],
        ['First appearance', profile.firstAppearance],
    ].map(([label, value]) => `| ${label} | ${escapeTableCell(value ?? '')} |`);

    const sections = CHARACTER_SECTION_FIELDS.map(([field, heading]) => `## ${heading}\n\n${profile[field] ?? ''}`);
    return [`# ${profile.name}`, '', '| Field | Value |', '|---|---|', ...tableRows, '', ...sections, ''].join('\n');
}

function parseCharacterProfile(content: string, fallbackName: string): CharacterProfile {
    const h1 = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
    const table = parseMarkdownTable(content);
    const sections = parseMarkdownSections(content);
    return {
        name: h1 || fallbackName,
        role: table.get('role'),
        age: table.get('age'),
        origin: table.get('origin'),
        skills: table.get('skills'),
        strengths: table.get('strengths'),
        weaknesses: table.get('weaknesses'),
        firstAppearance: table.get('first appearance'),
        personality: sections.get('personality'),
        background: sections.get('background'),
        narrativeArc: sections.get('narrative arc'),
        appearanceNotes: sections.get('appearance notes'),
        relationships: sections.get('relationships'),
        openQuestions: sections.get('open questions'),
        continuityNotes: sections.get('continuity notes'),
    };
}

function updateCharacterIndex(root: string, profile: CharacterProfile, relPath: string): void {
    const baseDir = charactersRoot(root);
    const indexPath = path.join(baseDir, 'index.md');
    fs.mkdirSync(baseDir, { recursive: true });
    if (!fs.existsSync(indexPath)) { fs.writeFileSync(indexPath, characterIndexTemplate(), 'utf-8'); }

    const row = `| [${profile.name}](${relPath}) | ${escapeTableCell(profile.role ?? '')} | ${escapeTableCell(profile.firstAppearance ?? '')} | ${escapeTableCell(profile.indexNotes ?? '')} |`;
    const slug = characterSlug(profile.name);
    const lines = fs.readFileSync(indexPath, 'utf-8').split(/\r?\n/)
        .filter(line => !line.toLowerCase().includes(`](${slug}.md)`) && !line.toLowerCase().startsWith(`| ${profile.name.toLowerCase()} |`));
    const separatorIndex = lines.findIndex(line => /^\|\s*-+\s*\|/.test(line));
    if (separatorIndex >= 0) {
        lines.splice(separatorIndex + 1, 0, row);
    } else {
        lines.push('', '| Character | Role | First appearance | Notes |', '|---|---|---|---|', row);
    }
    fs.writeFileSync(indexPath, lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', 'utf-8');
}

function escapeTableCell(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\|/g, '\\|')
        .replace(/\r?\n/g, '<br>');
}

// ─── arc_list / arc_get / arc_create / arc_update ───────────────────────────

type ArcProfile = {
    title: string;
    kind?: string;
    purpose?: string;
    majorBeats?: string;
    characterMovement?: string;
    worldImplications?: string;
    unresolvedQuestions?: string;
    continuityRisks?: string;
    linkedChapters?: string;
};

const ARC_SECTION_FIELDS: Array<[keyof ArcProfile, string]> = [
    ['purpose', 'Purpose'],
    ['majorBeats', 'Major Beats'],
    ['characterMovement', 'Character Movement'],
    ['worldImplications', 'World / Setting Implications'],
    ['unresolvedQuestions', 'Unresolved Questions'],
    ['continuityRisks', 'Continuity Risks'],
    ['linkedChapters', 'Linked Chapters'],
];

export function toolArcList(root: string, args: ArcListArgs = {}): string {
    const baseDir = arcRoot(root);
    if (!fs.existsSync(baseDir)) { return 'No arc folder found.'; }

    const files: string[] = [];
    collectAllMd(baseDir, files);
    const kindFilter = args.kind?.trim().toLowerCase();
    const rows = files
        .map(filePath => ({ filePath, profile: parseArcProfile(fs.readFileSync(filePath, 'utf-8'), titleFromNotePath(filePath)) }))
        .filter(({ filePath, profile }) => !kindFilter || (profile.kind?.toLowerCase() === kindFilter) || inferredArcKind(baseDir, filePath) === kindFilter)
        .sort((a, b) => path.relative(baseDir, a.filePath).localeCompare(path.relative(baseDir, b.filePath), undefined, { numeric: true }))
        .map(({ filePath, profile }) => {
            const rel = normalizeSlashes(path.relative(baseDir, filePath));
            const kind = profile.kind ?? inferredArcKind(baseDir, filePath);
            return `- ${rel} — ${profile.title}${kind ? ` (${kind})` : ''}`;
        });

    return rows.join('\n') || (kindFilter ? `No arc files matched kind: ${args.kind}` : 'No arc files found.');
}

export function toolArcGet(root: string, args: ArcGetArgs): string {
    const filePath = safeArcFile(root, args.path);
    if (!filePath) { return `Invalid arc path: ${args.path}`; }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) { return `Arc file not found: ${normalizeMarkdownPath(args.path)}`; }
    return fs.readFileSync(filePath, 'utf-8');
}

export function toolArcCreate(root: string, args: ArcCreateArgs): string {
    const filePath = safeArcFile(root, args.path);
    if (!filePath) { return `Invalid arc path: ${args.path}`; }
    const rel = normalizeMarkdownPath(args.path);
    if (fs.existsSync(filePath) && !args.overwrite) {
        return `Arc file already exists: ${rel}. Pass overwrite: true to replace it.`;
    }

    const profile = arcProfileFromArgs(args, titleFromNotePath(rel));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, renderArcProfile(profile), 'utf-8');
    updateArcIndex(root, profile, rel);
    return `${fs.existsSync(filePath) && args.overwrite ? 'Wrote' : 'Created'} arc file: ${rel}`;
}

export function toolArcUpdate(root: string, args: ArcUpdateArgs): string {
    const filePath = safeArcFile(root, args.path);
    if (!filePath) { return `Invalid arc path: ${args.path}`; }
    if (!fs.existsSync(filePath)) { return `Arc file not found: ${normalizeMarkdownPath(args.path)}. Use arc_create first.`; }

    const existing = parseArcProfile(fs.readFileSync(filePath, 'utf-8'), titleFromNotePath(args.path));
    const updated = mergeDefined(existing, arcProfileFromArgs(args, existing.title));
    fs.writeFileSync(filePath, renderArcProfile(updated), 'utf-8');
    updateArcIndex(root, updated, normalizeSlashes(path.relative(arcRoot(root), filePath)));
    return `Updated arc file: ${normalizeSlashes(path.relative(arcRoot(root), filePath))}`;
}

function arcRoot(root: string): string {
    return path.join(root, getArcFolder(readSettings(root) ?? null));
}

function safeArcFile(root: string, arcPath: string): string | null {
    const baseDir = arcRoot(root);
    const normalized = normalizeMarkdownPath(arcPath);
    const resolved = path.resolve(baseDir, normalized);
    const rel = path.relative(baseDir, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) { return null; }
    return resolved;
}

function normalizeMarkdownPath(markdownPath: string): string {
    const normalized = markdownPath.replace(/\\/g, '/').replace(/^\/+/, '');
    return normalized.toLowerCase().endsWith('.md') ? normalized : `${normalized}.md`;
}

function arcProfileFromArgs(args: ArcCreateArgs, fallbackTitle: string): ArcProfile {
    return {
        title: trimOrUndefined(args.title) ?? fallbackTitle,
        kind: trimOrUndefined(args.kind),
        purpose: trimOrUndefined(args.purpose),
        majorBeats: trimOrUndefined(args.majorBeats),
        characterMovement: trimOrUndefined(args.characterMovement),
        worldImplications: trimOrUndefined(args.worldImplications),
        unresolvedQuestions: trimOrUndefined(args.unresolvedQuestions),
        continuityRisks: trimOrUndefined(args.continuityRisks),
        linkedChapters: trimOrUndefined(args.linkedChapters),
    };
}

function renderArcProfile(profile: ArcProfile): string {
    const meta = profile.kind ? [`Kind: ${profile.kind}`, ''] : [];
    const sections = ARC_SECTION_FIELDS.map(([field, heading]) => `## ${heading}\n\n${profile[field] ?? ''}`);
    return [`# ${profile.title}`, '', ...meta, ...sections, ''].join('\n');
}

function parseArcProfile(content: string, fallbackTitle: string): ArcProfile {
    const title = /^#\s+(.+)$/m.exec(content)?.[1]?.trim() || fallbackTitle;
    const kind = /^Kind:\s+(.+)$/mi.exec(content)?.[1]?.trim();
    const sections = parseMarkdownSections(content);
    return {
        title,
        kind,
        purpose: sections.get('purpose'),
        majorBeats: sections.get('major beats'),
        characterMovement: sections.get('character movement'),
        worldImplications: sections.get('world / setting implications'),
        unresolvedQuestions: sections.get('unresolved questions'),
        continuityRisks: sections.get('continuity risks'),
        linkedChapters: sections.get('linked chapters'),
    };
}

function inferredArcKind(baseDir: string, filePath: string): string | undefined {
    const rel = normalizeSlashes(path.relative(baseDir, filePath)).toLowerCase();
    if (rel === 'overall.md') { return 'overall'; }
    if (rel.startsWith('acts/')) { return 'act'; }
    if (rel.startsWith('chapters/')) { return 'chapter'; }
    if (rel.startsWith('threads/')) { return 'thread'; }
    return undefined;
}

function updateArcIndex(root: string, profile: ArcProfile, relPath: string): void {
    const baseDir = arcRoot(root);
    const indexPath = path.join(baseDir, 'index.md');
    fs.mkdirSync(baseDir, { recursive: true });
    if (!fs.existsSync(indexPath)) { fs.writeFileSync(indexPath, arcIndexTemplate(getArcFolder(readSettings(root) ?? null)), 'utf-8'); }
    if (normalizeSlashes(relPath).toLowerCase() === 'index.md') { return; }

    const row = `- [${profile.title}](${relPath})${profile.kind ? ` — ${profile.kind}` : ''}`;
    const lines = fs.readFileSync(indexPath, 'utf-8').split(/\r?\n/)
        .filter(line => !line.includes(`](${relPath})`));
    lines.push(row);
    fs.writeFileSync(indexPath, lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', 'utf-8');
}

function parseMarkdownTable(content: string): Map<string, string> {
    const values = new Map<string, string>();
    for (const line of content.split(/\r?\n/)) {
        const match = /^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|$/.exec(line);
        if (!match) { continue; }
        const key = match[1].trim().toLowerCase();
        const value = match[2].replace(/<br>/g, '\n').replace(/\\\|/g, '|').trim();
        if (key && key !== 'field' && !/^-+$/.test(key)) { values.set(key, value || undefined as never); }
    }
    return values;
}

function parseMarkdownSections(content: string): Map<string, string> {
    const sections = new Map<string, string>();
    const matches = [...content.matchAll(/^##\s+(.+)$/gm)];
    for (let index = 0; index < matches.length; index++) {
        const match = matches[index];
        const next = matches[index + 1];
        if (match.index === undefined) { continue; }
        const start = match.index + match[0].length;
        const end = next?.index ?? content.length;
        const body = content.slice(start, end).trim();
        sections.set(match[1].trim().toLowerCase(), body || undefined as never);
    }
    return sections;
}

function mergeDefined<T extends Record<string, unknown>>(base: T, patch: T): T {
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined && value !== '') { merged[key] = value; }
    }
    return merged as T;
}

// ─── search ───────────────────────────────────────────────────────────────────

export interface SearchArgs {
    query:          string;
    language?:      string;
    maxResults?:    number;
    caseSensitive?: boolean;
    mode?:          SearchMode;
}

function addStalenessWarning(root: string, warnings: string[]): void {
    const semantic = loadSemanticIndex(root);
    if (!semantic) { return; }
    const stale = semanticIndexStaleness(root, semantic);
    if (stale.isStale) {
        warnings.push('semantic index is stale; run index_build. ' + stale.reasons.join('; '));
    }
}

async function applySearchMode(
    root:           string,
    mode:           SearchMode,
    lexicalResults: SearchResult[],
    query:          string,
    topK:           number,
    language:       string | undefined,
    warnings:       string[],
): Promise<SearchResult[]> {
    if (mode === 'semantic_rerank') {
        const reranked = await rerank(lexicalResults, query);
        if (reranked.warning) { warnings.push(reranked.warning); }
        return reranked.usedSemantic ? reranked.results : lexicalResults;
    }
    if (mode === 'full_semantic') {
        const semanticSearch = await fullSemanticSearch(root, query, topK * 4, language);
        if (semanticSearch.usedSemantic) {
            addStalenessWarning(root, warnings);
            return semanticSearch.results;
        }
        if (semanticSearch.warning) { warnings.push(semanticSearch.warning); }
    }
    return lexicalResults;
}

export async function toolSearch(root: string, args: SearchArgs): Promise<string> {
    const topK     = args.maxResults ?? Number.parseInt(process.env['BINDERY_DEFAULT_TOPK'] ?? '10', 10);
    const language = args.language?.toUpperCase();
    const mode     = args.mode ?? parseSearchMode(process.env['BINDERY_DEFAULT_SEARCH_MODE']);
    const warnings: string[] = [];

    const idxData = loadIndex(root) ?? buildIndex(root);
    const lexicalResults = search(idxData.ms, idxData.chunks, args.query, topK * 4, language);
    const results = (await applySearchMode(root, mode, lexicalResults, args.query, topK, language, warnings)).slice(0, topK);

    if (results.length === 0) { return appendWarnings('No results found.', warnings); }

    const maxBytes = Number.parseInt(process.env['BINDERY_MAX_RESPONSE_BYTES'] ?? '60000', 10);
    const parts: string[] = [];
    let total = 0;
    for (let i = 0; i < results.length; i++) {
        const fragment = formatResult(results[i], i + 1);
        if (total + fragment.length > maxBytes) { break; }
        parts.push(fragment);
        total += fragment.length;
    }
    return appendWarnings(parts.join('\n\n---\n\n') || 'No results found.', warnings);
}

// ─── format ───────────────────────────────────────────────────────────────────

export interface FormatArgs {
    filePath?:  string;
    dryRun?:    boolean;
    noRecurse?: boolean;
}

export function toolFormat(root: string, args: FormatArgs): string {
    let target = root;
    if (args.filePath) {
        target = path.isAbsolute(args.filePath) ? args.filePath : path.join(root, args.filePath);
    }

    const changed: string[] = [];

    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
        if (processFormatFile(target, args.dryRun ?? false)) { changed.push(target); }
    } else if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        formatDir(target, args.dryRun ?? false, !(args.noRecurse ?? false), changed);
    } else {
        return `Path not found: ${target}`;
    }

    if (args.dryRun) {
        return changed.length > 0
            ? `Would format ${changed.length} file(s):\n${changed.map(f => path.relative(root, f)).join('\n')}`
            : 'No files need formatting.';
    }
    return changed.length > 0
        ? `Formatted ${changed.length} file(s).`
        : 'No files needed formatting.';
}

function formatDir(dir: string, dry: boolean, recurse: boolean, changed: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && recurse) {
            formatDir(fullPath, dry, recurse, changed);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            if (processFormatFile(fullPath, dry)) { changed.push(fullPath); }
        }
    }
}

function processFormatFile(filePath: string, dry: boolean): boolean {
    const original  = fs.readFileSync(filePath, 'utf-8');
    const formatted = updateTypography(original);
    if (original === formatted) { return false; }
    if (!dry) { fs.writeFileSync(filePath, formatted, 'utf-8'); }
    return true;
}

// ─── get_review_text ──────────────────────────────────────────────────────────

export interface GetReviewTextArgs {
    language?:     string;
    contextLines?: number;
    autoStage?:    boolean;
}

export function toolGetReviewText(root: string, args: GetReviewTextArgs): string {
    const contextLines = args.contextLines ?? 3;
    const language     = (args.language ?? 'ALL').toUpperCase();
    const chapterPathspec = chapterMarkdownPathspec(root);

    // ── 1. Git diff ────────────────────────────────────────────────────────
    let raw: string;
    let gitAvailable = true;
    try {
        const result = spawnSync(
            'git', ['diff', '--ignore-cr-at-eol', `-U${contextLines}`, '--', chapterPathspec],
            { cwd: root, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
        );
        if (result.error) { throw result.error; }
        // git diff exits non-zero when run outside a repo (status 128) or when
        // the cwd is otherwise unusable. Treat that as "git unavailable" so the
        // caller gets an explicit notice instead of a confusingly empty diff.
        if (result.status !== 0) { throw new Error(result.stderr || 'git diff failed'); }
        raw = result.stdout;
    } catch {
        raw = '';
        gitAvailable = false;
    }

    if (!gitAvailable) {
        return 'Failed to run git diff. Is this a git repository?';
    }

    const diffFiles = raw.trim() ? parseUnifiedDiff(raw) : [];
    const filteredDiff = filterByLanguage(root, diffFiles, language);
    const diffSection  = filteredDiff.length > 0 ? formatReviewFiles(filteredDiff) : '';
    const reviewedFiles = filteredDiff.map(f => f.file);

    // ── 2. Marker regions in story markdown files ────────────────────────
    const markerFiles = collectReviewMarkerFiles(root, language);
    const markerSection = markerFiles.length > 0 ? formatReviewMarkerFiles(markerFiles) : '';

    // ── 3. Compose response ────────────────────────────────────────────────
    if (!diffSection && !markerSection) {
        return language === 'ALL'
            ? 'No uncommitted changes.'
            : `No uncommitted changes in ${language} files.`;
    }

    const parts: string[] = [];
    if (diffSection) {
        parts.push('# Git diff', diffSection);
    }
    if (markerSection) { parts.push('# Review markers', markerSection); }
    const result = parts.join('\n\n');

    // ── 4. autoStage: stage reviewed chapter files + consume markers ─────
    if (args.autoStage) {
        if (gitAvailable) {
            const stageFiles = uniquePaths([...reviewedFiles, ...markerFiles.map(f => f.file)]);
            if (stageFiles.length > 0) {
                try {
                    const r = spawnSync('git', ['add', ...stageFiles], { cwd: root, encoding: 'utf-8' });
                    if (r.error) { throw r.error; }
                } catch { /* best effort — staging failure shouldn't break the review */ }
            }
        }
        // Strip marker lines so the next review pass is clean. This performs
        // local file edits and then best-effort git add on touched files.
        if (markerFiles.length > 0) {
            consumeReviewMarkers(root, markerFiles.map(f => f.file));
        }
    }

    return result;
}

function filterByLanguage<T extends { file: string }>(root: string, items: T[], language: string): T[] {
    if (language === 'ALL') { return items; }
    return items.filter(f => fileMatchesLanguage(root, f.file, language));
}

/** Scan story markdown files for review markers, even when the file is already committed. */
function collectReviewMarkerFiles(root: string, language: string): FormattedMarkerFile[] {
    const out: FormattedMarkerFile[] = [];
    for (const rel of listStoryMarkdownFiles(root, language)) {
        const abs = path.join(root, rel);
        let content: string;
        try { content = fs.readFileSync(abs, 'utf-8'); }
        catch { continue; }
        const scan = scanReviewMarkers(content);
        if (scan.regions.length === 0 && scan.warnings.length === 0) { continue; }
        out.push({ file: rel, regions: scan.regions, warnings: scan.warnings });
    }
    return out;
}

function chapterMarkdownPathspec(root: string): string {
    const story = storyFolder(root).replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
    return `:(glob)${story}/**/*.md`;
}

function listStoryMarkdownFiles(root: string, language: string): string[] {
    const storyRoots = getStoryScanRoots(root, language);
    const files: string[] = [];
    for (const storyRoot of storyRoots) {
        collectMarkdownFiles(storyRoot, files);
    }
    return uniquePaths(files.map(file => path.relative(root, file)));
}

function fileMatchesLanguage(root: string, file: string, language: string): boolean {
    if (language === 'ALL') { return true; }
    const normalizedFile = file.replaceAll('\\', '/').toUpperCase();
    const story = storyFolder(root).replaceAll('\\', '/').replace(/^\/+|\/+$/g, '').toUpperCase();
    return getLanguageFolderNames(root, language).some(folder => {
        const prefix = `${story}/${folder.toUpperCase()}/`;
        return normalizedFile.startsWith(prefix) || normalizedFile.includes(`/${prefix}`);
    });
}

function getStoryScanRoots(root: string, language: string): string[] {
    const storyRoot = path.join(root, storyFolder(root));
    try {
        if (!fs.statSync(storyRoot).isDirectory()) { return []; }
    } catch {
        return [];
    }
    if (language === 'ALL') {
        return [storyRoot];
    }

    const roots = getLanguageFolderNames(root, language)
        .map(folder => path.join(storyRoot, folder))
        .filter(dir => {
            try {
                return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
            } catch {
                return false;
            }
        });

    return roots.length > 0 ? uniquePaths(roots) : [];
}

function getLanguageFolderNames(root: string, language: string): string[] {
    const upper = language.toUpperCase();
    const names = new Set<string>([upper]);
    const settings = readSettings(root);
    for (const entry of settings?.languages ?? []) {
        if (entry.code.toUpperCase() !== upper) { continue; }
        if (typeof entry.folderName === 'string' && entry.folderName.trim()) {
            names.add(entry.folderName.trim());
        }
    }
    return Array.from(names);
}

function collectMarkdownFiles(dir: string, acc: string[]): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectMarkdownFiles(fullPath, acc);
            continue;
        }
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
            acc.push(fullPath);
        }
    }
}

function uniquePaths(items: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of items) {
        const rel = item.replaceAll('\\', '/');
        if (seen.has(rel)) { continue; }
        seen.add(rel);
        out.push(rel);
    }
    return out;
}


function consumeReviewMarkers(root: string, relFiles: string[]): void {
    const touched: string[] = [];
    for (const rel of relFiles) {
        const abs = path.join(root, rel);
        let content: string;
        try { content = fs.readFileSync(abs, 'utf-8'); }
        catch { continue; }
        const { text, removed } = stripReviewMarkers(content);
        if (removed === 0 || text === content) { continue; }
        try {
            fs.writeFileSync(abs, text, 'utf-8');
            touched.push(rel);
        } catch { /* best effort */ }
    }
    if (touched.length > 0) {
        try {
            spawnSync('git', ['add', ...touched], { cwd: root, encoding: 'utf-8' });
        } catch { /* best effort */ }
    }
}

// ─── update_workspace ────────────────────────────────────────────────────────

export interface UpdateWorkspaceArgs {
    remote?: string;
    branch?: string;
    switchBranch?: boolean;
    autoStash?: boolean;
}

export function toolUpdateWorkspace(root: string, args: UpdateWorkspaceArgs): string {
    const repoError = ensureGitRepository(root);
    if (repoError) { return repoError; }

    const requestedRemote = trimOrUndefined(args.remote);
    const requestedBranch = trimOrUndefined(args.branch);
    const remote = pickRemote(root, requestedRemote);
    if (!remote) {
        return 'Failed to update workspace: no git remote is configured for this repository.';
    }

    const lines: string[] = [];
    const autoStash = args.autoStash !== false;

    try {
        lines.push(fetchWorkspaceRemote(root, remote));
    } catch (error) {
        return `Failed to update workspace: ${error instanceof Error ? error.message : String(error)}`;
    }

    const defaultBranch = remoteDefaultBranch(root, remote);
    let activeBranch = currentBranch(root);
    if (!activeBranch) {
        return 'Failed to update workspace: unable to determine the current branch.';
    }

    const switchResult = maybeSwitchWorkspaceBranch(root, remote, activeBranch, requestedBranch, args.switchBranch);
    if (switchResult.error) { return switchResult.error; }
    activeBranch = switchResult.activeBranch ?? activeBranch;
    if (switchResult.note) { lines.push(switchResult.note); }

    const upstreamNote = ensureWorkspaceUpstream(root, remote, activeBranch, defaultBranch);
    if (upstreamNote?.startsWith('Failed to update workspace:')) {
        return upstreamNote;
    }
    if (upstreamNote) { lines.push(upstreamNote); }

    const stashState = stashWorkspaceChanges(root, autoStash);
    if (stashState.note) { lines.push(stashState.note); }

    const pullWorkspaceResult = pullWorkspace(root, stashState);
    if (pullWorkspaceResult.error) { return pullWorkspaceResult.error; }
    lines.push(...pullWorkspaceResult.lines, workspaceBranchStatus(activeBranch, remote, defaultBranch));

    const reminder = switchBranchReminder(requestedBranch, activeBranch, args.switchBranch);
    if (reminder) { lines.push(reminder); }

    return lines.join('\n');
}

// ─── git_snapshot ─────────────────────────────────────────────────────────────

export interface GitSnapshotArgs {
    message?: string;
    push?: boolean;
    remote?: string;
    branch?: string;
    rememberPushDefaults?: boolean;
}

export function toolGitSnapshot(root: string, args: GitSnapshotArgs): string {
    // Stage everything tracked or untracked in the repo
    try {
        const result = spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf-8' });
        if (result.error) { throw result.error; }
        if (result.status !== 0) { throw new Error(result.stderr || 'git add failed'); }
    } catch {
        return 'Failed to stage files. Is this a git repository?';
    }

    // Check if there is anything staged
    let staged: string;
    try {
        const result = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf-8' });
        if (result.error) { throw result.error; }
        staged = result.stdout;
    } catch {
        return 'Failed to check staged files.';
    }

    if (!staged.trim()) { return 'Nothing to snapshot — no changes to commit.'; }

    const fileCount = staged.trim().split('\n').length;
    const msg       = args.message ?? `Snapshot ${new Date().toISOString().slice(0, 16).replaceAll('T', ' ')}`;

    try {
        const result = spawnSync('git', ['commit', '-m', msg], { cwd: root, encoding: 'utf-8' });
        if (result.error) { throw result.error; }
        if (result.status !== 0) { throw new Error(result.stderr || 'git commit failed'); }
    } catch (e) {
        return `Failed to commit: ${e instanceof Error ? e.message : String(e)}`;
    }

    const lines = [`Snapshot saved: "${msg}" (${fileCount} file${fileCount === 1 ? '' : 's'})`];

    const settings = readSettings(root);
    const defaultPush = settings?.git?.snapshot?.pushDefault === true;
    const pushRequested = args.push ?? defaultPush;
    const remote = trimOrUndefined(args.remote) ?? trimOrUndefined(settings?.git?.snapshot?.remote) ?? pickRemote(root);
    const branch = trimOrUndefined(args.branch) ?? trimOrUndefined(settings?.git?.snapshot?.branch) ?? currentBranch(root);

    const rememberNote = maybeRememberSnapshotDefaults(root, args.rememberPushDefaults, pushRequested, remote, branch);
    if (rememberNote) { lines.push(rememberNote); }

    if (!pushRequested) {
        return lines.join('\n');
    }

    lines.push(pushSnapshot(root, remote, branch));

    return lines.join('\n');
}

// ─── get_translation ─────────────────────────────────────────────────────────

export interface GetTranslationArgs {
    language: string;
    word?:    string;
    /** Filter by entry type. Default: 'glossary' (cross-language reference). */
    type?:    'glossary' | 'substitution';
}

export function toolGetTranslation(root: string, args: GetTranslationArgs): string {
    const filePath = path.join(root, '.bindery', 'translations.json');
    if (!fs.existsSync(filePath)) {
        return 'No translations.json found. Run "init_workspace" or "add_translation" first.';
    }

    let translations: TranslationsFile;
    try { translations = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TranslationsFile; }
    catch { return 'Error: failed to parse .bindery/translations.json'; }

    const entryType = args.type ?? 'glossary';
    const langLower = args.language.toLowerCase();

    // Resolve key — case-insensitive, accept code or label
    const matchedKey = Object.keys(translations).find(
        k => k.toLowerCase() === langLower ||
             translations[k].label?.toLowerCase() === langLower ||
             translations[k].sourceLanguage?.toLowerCase() === langLower
    );

    if (!matchedKey) {
        const available = Object.entries(translations)
            .filter(([, e]) => e.type === entryType || args.type === undefined)
            .map(([k, e]) => k + (e.label ? ` (${e.label})` : ''))
            .join(', ');
        return `No translation entry found for "${args.language}". Available: ${available || 'none'}`;
    }

    const entry = translations[matchedKey];
    if (entry.type !== entryType) {
        return `Entry "${matchedKey}" is type "${entry.type}", not "${entryType}". Use get_dialect for substitution rules.`;
    }

    const rules = entry.rules ?? [];
    if (!args.word) {
        if (rules.length === 0) { return `No rules defined for "${matchedKey}" yet.`; }
        const labelPart = entry.label ? ` — ${entry.label}` : '';
        const header = `${matchedKey}${labelPart} (${entry.type}, ${rules.length} rules):`;
        return [header, ...rules.map(r => `  ${r.from}  →  ${r.to}`)].join('\n');
    }

    const stems = wordStems(args.word.toLowerCase());
    const matches = rules.filter(r => stems.includes(r.from.toLowerCase()));
    if (matches.length === 0) { return `"${args.word}" not found in ${matchedKey} translations.`; }
    return matches.map(r => `${r.from}  →  ${r.to}  [${matchedKey}]`).join('\n');
}

/** Generate stem variants for forgiving word lookup. */
function wordStems(word: string): string[] {
    const variants = new Set<string>([word]);
    // strip common suffixes to reach a base form
    if (word.endsWith('ies'))   { variants.add(word.slice(0, -3) + 'y'); }
    if (word.endsWith('es'))    { variants.add(word.slice(0, -2)); }
    if (word.endsWith('s'))     { variants.add(word.slice(0, -1)); }
    if (word.endsWith('ed'))    { variants.add(word.slice(0, -2)); variants.add(word.slice(0, -1)); }
    if (word.endsWith('ing'))   { variants.add(word.slice(0, -3)); variants.add(word.slice(0, -3) + 'e'); }
    // also try adding -s so a bare stem matches plurals stored in the file
    variants.add(word + 's');
    return Array.from(variants);
}

// ─── add_translation ──────────────────────────────────────────────────────────

export interface AddTranslationArgs {
    /** Target language code (e.g. 'nl', 'fr'). Used as key in translations.json. */
    targetLangCode: string;
    from:           string;
    to:             string;
}

interface TranslationEntry { label?: string; type: string; sourceLanguage?: string; rules?: TranslationRule[]; ignoredWords?: string[] }
type TranslationsFile = Record<string, TranslationEntry>;

// ─── Built-in en-gb substitution rules (US → British English) ────────────────
// Data lives in ./tools-dialect-defaults.ts — BUILTIN_EN_GB_RULES is imported above.

export function toolAddTranslation(root: string, args: AddTranslationArgs): string {
    const { targetLangCode, from, to } = args;
    if (!from.trim() || !to.trim()) { return 'Error: both "from" and "to" must be non-empty.'; }

    const filePath = path.join(root, '.bindery', 'translations.json');
    let translations: TranslationsFile = {};
    if (fs.existsSync(filePath)) {
        try { translations = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TranslationsFile; }
        catch { return 'Error: failed to parse .bindery/translations.json'; }
    }

    // Default source: EN (from settings) or 'en'
    let sourceLanguage = 'en';
    const settings = readSettings(root) as { languages?: Array<{ code: string; isDefault?: boolean }> } | null;
    const defaultLang = (settings?.languages ?? []).find(l => l.isDefault) ?? settings?.languages?.[0];
    if (defaultLang) { sourceLanguage = defaultLang.code.toLowerCase(); }

    const key = targetLangCode.toLowerCase();
    if (!translations[key]) {
        translations[key] = { type: 'glossary', sourceLanguage, rules: [], ignoredWords: [] };
    }
    const entry = translations[key];
    const rules = entry.rules ?? [];
    const idx   = rules.findIndex(r => r.from.toLowerCase() === from.toLowerCase());
    const isUpdate = idx >= 0;
    if (isUpdate) { rules[idx] = { from, to }; }
    else           { rules.push({ from, to }); rules.sort((a, b) => a.from.localeCompare(b.from)); }
    entry.rules = rules;

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(translations, null, 2) + '\n', 'utf-8');

    return `${isUpdate ? 'Updated' : 'Added'} glossary: ${from} → ${to} (${key})`;
}

// ─── add_dialect ──────────────────────────────────────────────────────────────

export interface AddDialectArgs {
    /** Dialect code used as key in translations.json, e.g. 'en-gb'. */
    dialectCode: string;
    from:        string;
    to:          string;
}

export function toolAddDialect(root: string, args: AddDialectArgs): string {
    const { dialectCode, from, to } = args;
    if (!from.trim() || !to.trim()) { return 'Error: both "from" and "to" must be non-empty.'; }

    const filePath = path.join(root, '.bindery', 'translations.json');
    let translations: TranslationsFile = {};
    if (fs.existsSync(filePath)) {
        try { translations = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TranslationsFile; }
        catch { return 'Error: failed to parse .bindery/translations.json'; }
    }

    const key = dialectCode.toLowerCase();
    if (!translations[key]) {
        translations[key] = { type: 'substitution', sourceLanguage: 'en', rules: [], ignoredWords: [] };
    }
    const entry = translations[key];
    if (entry.type !== 'substitution') {
        return `Error: entry '${key}' has type '${entry.type}', expected 'substitution'. Use add_translation for glossary entries.`;
    }

    const rules    = entry.rules ?? [];
    const fromLower = from.toLowerCase();
    const idx       = rules.findIndex(r => r.from.toLowerCase() === fromLower);
    const isUpdate  = idx >= 0;
    if (isUpdate) { rules[idx] = { from: fromLower, to }; }
    else           { rules.push({ from: fromLower, to }); rules.sort((a, b) => a.from.localeCompare(b.from)); }
    entry.rules = rules;

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(translations, null, 2) + '\n', 'utf-8');

    return `${isUpdate ? 'Updated' : 'Added'} dialect rule: ${fromLower} → ${to} (${key})`;
}

// ─── get_dialect ──────────────────────────────────────────────────────────────

export interface GetDialectArgs {
    dialectCode: string;
    word?:       string;
}

export function toolGetDialect(root: string, args: GetDialectArgs): string {
    const filePath = path.join(root, '.bindery', 'translations.json');
    if (!fs.existsSync(filePath)) {
        return 'No translations.json found. Run "init_workspace" or "add_dialect" first.';
    }

    let translations: TranslationsFile;
    try { translations = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TranslationsFile; }
    catch { return 'Error: failed to parse .bindery/translations.json'; }

    const key = Object.keys(translations).find(k => k.toLowerCase() === args.dialectCode.toLowerCase());
    if (!key) {
        const available = Object.entries(translations)
            .filter(([, e]) => e.type === 'substitution')
            .map(([k]) => k).join(', ');
        return `No dialect entry "${args.dialectCode}". Available: ${available || 'none'}`;
    }

    const entry = translations[key];
    if (entry.type !== 'substitution') {
        return `Entry "${key}" is type "${entry.type}", not "substitution". Use get_translation for glossary entries.`;
    }

    const rules = entry.rules ?? [];
    if (!args.word) {
        if (rules.length === 0) { return `No dialect rules defined for "${key}" yet.`; }
        const labelPart = entry.label ? ` — ${entry.label}` : '';
        const header = `${key}${labelPart} (${rules.length} substitution rules):`;
        return [header, ...rules.map(r => `  ${r.from}  →  ${r.to}`)].join('\n');
    }

    const stems   = wordStems(args.word.toLowerCase());
    const matches = rules.filter(r => stems.includes(r.from.toLowerCase()));
    if (matches.length === 0) { return `"${args.word}" not found in dialect "${key}".`; }
    return matches.map(r => `${r.from}  →  ${r.to}  [${key}]`).join('\n');
}

// ─── add_language ─────────────────────────────────────────────────────────────

export interface AddLanguageArgs {
    code:           string;
    folderName?:    string;
    chapterWord?:   string;
    actPrefix?:     string;
    prologueLabel?: string;
    epilogueLabel?: string;
    /** Mirror source language's folder structure with empty stubs. Default true. */
    createStubs?:   boolean;
}

interface LanguageEntry { code: string; folderName: string; chapterWord: string; actPrefix: string; prologueLabel: string; epilogueLabel: string; isDefault?: boolean }

export function toolAddLanguage(root: string, args: AddLanguageArgs): string {
    const settingsPath = path.join(root, '.bindery', 'settings.json');

    let existing: Record<string, unknown> = {};
    try { existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>; }
    catch { return 'Error: .bindery/settings.json not found. Run init_workspace first.'; }

    const upper = args.code.trim().toUpperCase();
    const newLang: LanguageEntry = {
        code:          upper,
        folderName:    args.folderName?.trim()    ?? upper,
        chapterWord:   args.chapterWord?.trim()   ?? 'Chapter',
        actPrefix:     args.actPrefix?.trim()     ?? 'Act',
        prologueLabel: args.prologueLabel?.trim() ?? 'Prologue',
        epilogueLabel: args.epilogueLabel?.trim() ?? 'Epilogue',
    };

    const languages: LanguageEntry[] = ((existing['languages'] as LanguageEntry[] | undefined) ?? []);
    const dupIdx = languages.findIndex(l => l.code.toUpperCase() === upper);
    if (dupIdx >= 0) { languages[dupIdx] = newLang; } else { languages.push(newLang); }
    existing['languages'] = languages;

    fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');

    // Create stub files mirroring source language (default: true)
    const createStubs = args.createStubs !== false;
    const storyFolderName = (existing['storyFolder'] as string | undefined) ?? 'Story';
    const sourceLang = languages.find((l: LanguageEntry) => l.isDefault) ?? languages[0];

    let stubCount = 0;
    if (createStubs && sourceLang && sourceLang.code !== upper) {
        const sourceDir = path.join(root, storyFolderName, sourceLang.folderName);
        const targetDir = path.join(root, storyFolderName, newLang.folderName);
        fs.mkdirSync(targetDir, { recursive: true });

        if (fs.existsSync(sourceDir)) {
            const createStubsIn = (srcDir: string, dstDir: string) => {
                fs.mkdirSync(dstDir, { recursive: true });
                for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
                    const srcPath = path.join(srcDir, entry.name);
                    const dstPath = path.join(dstDir, entry.name);
                    if (entry.isDirectory()) {
                        createStubsIn(srcPath, dstPath);
                    } else if (entry.isFile() && entry.name.endsWith('.md')) {
                        if (!fs.existsSync(dstPath)) {
                            const src    = fs.readFileSync(srcPath, 'utf-8');
                            const h1     = /^#\s+(.+)/m.exec(src);
                            const title  = h1 ? h1[1].trim() : path.basename(entry.name, '.md');
                            fs.writeFileSync(dstPath, `# [Untranslated] ${title}\n`, 'utf-8');
                            stubCount++;
                        }
                    }
                }
            };
            createStubsIn(sourceDir, targetDir);
        }
    }

    return `Added language ${upper} to settings.json. Story/${newLang.folderName}/ created with ${stubCount} stub file(s).`;
}

// ─── diff helpers ─────────────────────────────────────────────────────────────
// Parsing/formatting lives in ./tools-diff.ts.

// ─── init_workspace ──────────────────────────────────────────────────────────

export interface InitWorkspaceArgs {
    bookTitle?:      string;
    author?:         string;
    storyFolder?:    string;
    genre?:          string;
    description?:    string;
    targetAudience?: string;
}

type LangEntry = { code: string; folderName: string; chapterWord: string; actPrefix: string; prologueLabel: string; epilogueLabel: string };

function detectWorkspaceLangs(
    storyPath:    string,
    existingLangs: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
    const detected: LangEntry[] = [];
    if (fs.existsSync(storyPath)) {
        for (const entry of fs.readdirSync(storyPath, { withFileTypes: true })) {
            if (entry.isDirectory() && /^[A-Z]{2,3}$/i.test(entry.name)) {
                detected.push({ code: entry.name.toUpperCase(), folderName: entry.name, chapterWord: 'Chapter', actPrefix: 'Act', prologueLabel: 'Prologue', epilogueLabel: 'Epilogue' });
            }
        }
    }
    if (detected.length === 0 && existingLangs.length > 0) {
        return existingLangs;
    }
    const base = detected.length > 0
        ? detected
        : [{ code: 'EN', folderName: 'EN', chapterWord: 'Chapter', actPrefix: 'Act', prologueLabel: 'Prologue', epilogueLabel: 'Epilogue', isDefault: true }];
    return base.map(dl => {
        const el = existingLangs.find(l => (l['code'] as string | undefined)?.toUpperCase() === dl.code);
        return el ? { ...el, code: dl.code, folderName: dl.folderName } : (dl);
    });
}

function seedTranslations(translationsPath: string, languages: Array<Record<string, unknown>>): boolean {
    type LangWithDialects = { dialects?: Array<{ code: string }> };
    const engbDeclared = languages.some((l: unknown) =>
        (l as LangWithDialects).dialects?.some(d => d.code?.toLowerCase() === 'en-gb')
    );
    if (!engbDeclared) { return false; }

    let trans: TranslationsFile = {};
    if (fs.existsSync(translationsPath)) {
        try { trans = JSON.parse(fs.readFileSync(translationsPath, 'utf-8')) as TranslationsFile; } catch { /* ignore */ }
    }
    if (trans['en-gb']?.rules?.length) { return false; }

    trans['en-gb'] = { label: 'British English', type: 'substitution', sourceLanguage: 'en', rules: BUILTIN_EN_GB_RULES, ignoredWords: [] };
    fs.writeFileSync(translationsPath, JSON.stringify(trans, null, 2) + '\n', 'utf-8');
    return true;
}

function writeScaffoldFile(root: string, relPath: string, content: string): boolean {
    const filePath = path.join(root, ...relPath.split('/'));
    if (fs.existsSync(filePath)) { return false; }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
}

function ensureScaffoldDir(root: string, relPath: string): boolean {
    const dirPath = path.join(root, ...relPath.split('/'));
    const existed = fs.existsSync(dirPath);
    fs.mkdirSync(dirPath, { recursive: true });
    return !existed;
}

function titleAsString(value: unknown, fallback: string): string {
    if (typeof value === 'string' && value.trim()) { return value.trim(); }
    if (value && typeof value === 'object') {
        const titles = value as Record<string, unknown>;
        const en = titles['en'];
        if (typeof en === 'string' && en.trim()) { return en.trim(); }
        const first = Object.values(titles).find(v => typeof v === 'string' && v.trim());
        if (typeof first === 'string') { return first.trim(); }
    }
    return fallback;
}

function cowriteSessionFile(settings: Record<string, unknown>, _languages: Array<Record<string, unknown>>): string {
    const title = titleAsString(settings['bookTitle'], 'Untitled');
    return `# Session — ${title}

Ephemeral working state. Bindery and agents keep current focus and handoff here, and \`session_focus_*\` tools update its sections.
Durable preferences live in PREFERENCES.md; durable story decisions live in \`.bindery/memories/\`.

## Current Focus


## Next Actions


## Open Questions


## Handoff Notes

`;
}

function preferencesFileTemplate(settings: Record<string, unknown>): string {
    const title = titleAsString(settings['bookTitle'], 'Untitled');
    return `# Preferences — ${title}

Your durable working preferences. User-owned: Bindery scaffolds this once and never edits it.
"Do it like this for me" — tone, conventions, review style, and collaboration rules. Current working state belongs in SESSION.md.

## Working Style


## Writing Conventions


## Review Preferences


## Collaboration Notes

`;
}

function arcIndexTemplate(arcFolderName: string): string {
    return `# Arc Index

Use this folder for story architecture: premise, structure, act beats, chapter placement, and thread tracking.

## Core files

- [Overall](Overall.md) - whole-book arc, central promise, ending direction, and major turns.
- [Acts](Acts/) - act-level planning files. This is the default Bindery recommendation for novels.

## Optional structures

- \`${arcFolderName}/Chapters/\` - chapter-level planning for detailed outliners.
- \`${arcFolderName}/Threads/\` - theme, mystery, relationship, faction, or world-plot threads.
`;
}

function overallArcTemplate(): string {
    return `# Overall Arc

## Premise


## Story Promise


## Major Turns

- Opening:
- First major turn:
- Midpoint:
- Crisis:
- Climax:
- Resolution:

## Character Movement


## World / Setting Movement


## Open Questions


## Continuity Risks

`;
}

function characterIndexTemplate(): string {
    return `# Character Index

Use one file per character in this folder. Keep this index for quick cast navigation and role summaries.

| Character | Role | First appearance | Notes |
|---|---|---|---|
`;
}

function noteIndexTemplate(title: string, purpose: string): string {
    return `# ${title}

${purpose}
`;
}

function memoryTemplate(title: string): string {
    return `# Global Memory - ${title}

Use this file for durable cross-chapter decisions, recurring constraints, and story rules that should survive across sessions.
`;
}

function scaffoldOpinionatedWorkspace(root: string, settings: Record<string, unknown>, languages: Array<Record<string, unknown>>): string[] {
    const created: string[] = [];
    const typedSettings = settings as WorkspaceSettings;
    const storyFolderName = getStoryFolder(typedSettings);
    const notesFolderName = getNotesFolder(typedSettings);
    const arcFolderName = getArcFolder(typedSettings);
    const charactersFolderName = getCharactersFolder(typedSettings);
    const sessionFileName = getSessionFile(typedSettings);
    const preferencesFileName = getPreferencesFile(typedSettings);
    const title = titleAsString(settings['bookTitle'], path.basename(root));

    for (const lang of languages) {
        const folderName = typeof lang['folderName'] === 'string' ? lang['folderName'] : lang['code'];
        if (typeof folderName === 'string' && folderName.trim()) {
            const rel = `${storyFolderName}/${folderName.trim()}`;
            if (ensureScaffoldDir(root, rel)) { created.push(`${rel}/`); }
        }
    }

    const dirs = [
        `${arcFolderName}/Acts`,
        `${notesFolderName}/World`,
        `${notesFolderName}/Scenes`,
        `${notesFolderName}/Research`,
        charactersFolderName,
        '.bindery/memories/archive',
    ];
    for (const dir of dirs) {
        if (ensureScaffoldDir(root, dir)) { created.push(`${dir}/`); }
    }

    const files: Array<[string, string]> = [
        [sessionFileName, cowriteSessionFile(settings, languages)],
        [preferencesFileName, preferencesFileTemplate(settings)],
        [`${arcFolderName}/index.md`, arcIndexTemplate(arcFolderName)],
        [`${arcFolderName}/Overall.md`, overallArcTemplate()],
        [`${notesFolderName}/Inbox.md`, noteIndexTemplate('Inbox', 'Drop loose ideas, pasted mobile chats, and unsorted notes here. Triage them with inbox_process, then route confirmed items to notes, characters, arcs, or memory and clear them with inbox_resolve.')],
        [`${notesFolderName}/World/index.md`, noteIndexTemplate('World Notes', 'World rules, setting facts, magic/technology constraints, and culture notes.')],
        [`${notesFolderName}/Scenes/index.md`, noteIndexTemplate('Scene Notes', 'Loose scene ideas, set pieces, fragments, and placement candidates.')],
        [`${notesFolderName}/Research/index.md`, noteIndexTemplate('Research Notes', 'Research references, factual checks, and source links.')],
        [`${charactersFolderName}/index.md`, characterIndexTemplate()],
        ['.bindery/memories/global.md', memoryTemplate(title)],
    ];
    for (const [relPath, content] of files) {
        if (writeScaffoldFile(root, relPath, content)) { created.push(relPath); }
    }

    return created;
}

export function toolInitWorkspace(root: string, args: InitWorkspaceArgs): string {
    const settingsPath     = path.join(root, '.bindery', 'settings.json');
    const translationsPath = path.join(root, '.bindery', 'translations.json');

    let existing: Record<string, unknown> = {};
    const isNew = !fs.existsSync(settingsPath);
    if (!isNew) {
        try { existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>; }
        catch { /* corrupt — treat as new */ }
    }

    const storyFolderName = args.storyFolder ?? (existing['storyFolder'] as string | undefined) ?? 'Story';
    const bookTitle       = args.bookTitle   ?? existing['bookTitle'] ?? path.basename(root);
    const existingLangs   = ((existing['languages'] as unknown[] | undefined) ?? []) as Array<Record<string, unknown>>;
    const languages       = detectWorkspaceLangs(path.join(root, storyFolderName), existingLangs);

    const settingsForDefaults: WorkspaceSettings = {
        storyFolder:       storyFolderName,
        notesFolder:       existing['notesFolder'] as string | undefined,
        arcFolder:         existing['arcFolder'] as string | undefined,
        charactersFolder:  existing['charactersFolder'] as string | undefined,
        sessionFile:       existing['sessionFile'] as string | undefined,
        preferencesFile:   existing['preferencesFile'] as string | undefined,
        arcGranularity:    existing['arcGranularity'] as WorkspaceSettings['arcGranularity'],
    };

    const slugSource = titleAsString(bookTitle, path.basename(root));
    const slug = slugSource.replaceAll(/[^a-zA-Z0-9]+/g, '_').replaceAll(/^_|_$/g, '') || 'Book';
    const settings: Record<string, unknown> = {
        ...existing,
        bookTitle,
        ...(args.author         ? { author: args.author }                : {}),
        ...(args.genre          ? { genre: args.genre }                  : {}),
        ...(args.description    ? { description: args.description }      : {}),
        ...(args.targetAudience ? { targetAudience: args.targetAudience }: {}),
        storyFolder:     storyFolderName,
        notesFolder:     existing['notesFolder']      ?? getNotesFolder(settingsForDefaults),
        arcFolder:       existing['arcFolder']        ?? getArcFolder(settingsForDefaults),
        charactersFolder: existing['charactersFolder'] ?? getCharactersFolder(settingsForDefaults),
        sessionFile:     existing['sessionFile']      ?? getSessionFile(settingsForDefaults),
        preferencesFile: existing['preferencesFile']  ?? getPreferencesFile(settingsForDefaults),
        arcGranularity:  existing['arcGranularity']   ?? getArcGranularity(settingsForDefaults),
        mergedOutputDir: (existing['mergedOutputDir'])  ?? 'Merged',
        mergeFilePrefix: (existing['mergeFilePrefix'])  ?? slug,
        formatOnSave:    (existing['formatOnSave']) ?? false,
        languages,
    };

    fs.mkdirSync(path.join(root, '.bindery'), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    const created: string[] = ['.bindery/settings.json'];

    if (!fs.existsSync(translationsPath)) {
        const translations = {
            'en-gb': { label: 'British English', type: 'substitution', sourceLanguage: 'en', rules: [], ignoredWords: [] },
        };
        fs.writeFileSync(translationsPath, JSON.stringify(translations, null, 2) + '\n', 'utf-8');
        created.push('.bindery/translations.json');
    }

    const engbSeeded = seedTranslations(translationsPath, languages);

    const scaffoldCreated = scaffoldOpinionatedWorkspace(root, settings, languages);
    created.push(...scaffoldCreated);

    // Always (re)write the capabilities README so agents have a single canonical
    // "what can Bindery do?" reference from the moment a workspace is initialized.
    try { writeBinderyCapabilitiesReadme(root); created.push('.bindery/README.md'); }
    catch { /* non-fatal — setup_ai_files will write it next time */ }

    const action   = isNew ? 'Initialized' : 'Updated';
    const langNote = languages.map(l => (l as { code: string }).code).join(', ');
    const hint     = isNew
        ? '\n\nTip: AI instruction files (CLAUDE.md, skills, copilot-instructions.md) are not yet set up. Run setup_ai_files to generate them, or use "Bindery: Set Up AI Files" in VS Code.'
        : '';
    const engbNote = engbSeeded ? ' en-gb dialect seeded (75 rules).' : '';
    return `${action}: ${created.join(', ')}. Book: "${slugSource}", story folder: ${storyFolderName}/, languages: ${langNote}.${engbNote}${hint}`;
}

// ─── settings_update ───────────────────────────────────────────────────────

export interface SettingsUpdateArgs {
    patch: Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Disallow keys that can mutate object prototypes when merged from untrusted input.
 */
function isUnsafeMergeKey(key: string): boolean {
    return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

/**
 * Deep-clone plain objects while filtering unsafe merge keys. Primitive and array values
 * are copied by reference for settings payload compatibility.
 */
function cloneSettingsObject(value: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
        if (isUnsafeMergeKey(key)) {
            continue;
        }
        const entry = value[key];
        out[key] = isPlainObject(entry) ? cloneSettingsObject(entry) : entry;
    }
    return out;
}

function deepMergeSettings(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    for (const key of Object.keys(base)) {
        if (isUnsafeMergeKey(key)) {
            continue;
        }
        const baseValue = base[key];
        out[key] = isPlainObject(baseValue) ? cloneSettingsObject(baseValue) : baseValue;
    }

    for (const key of Object.keys(patch)) {
        if (isUnsafeMergeKey(key)) {
            continue;
        }
        const patchValue = patch[key];
        const baseValue = out[key];
        if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
            out[key] = deepMergeSettings(baseValue, patchValue);
            continue;
        }
        out[key] = isPlainObject(patchValue) ? cloneSettingsObject(patchValue) : patchValue;
    }
    return out;
}

export function toolSettingsUpdate(root: string, args: SettingsUpdateArgs): string {
    const settingsPath = path.join(root, '.bindery', 'settings.json');
    if (!fs.existsSync(settingsPath)) {
        return 'Error: .bindery/settings.json not found. Run init_workspace first.';
    }
    if (!isPlainObject(args.patch) || Object.keys(args.patch).length === 0) {
        return 'Error: patch must be a non-empty object.';
    }

    let existing: Record<string, unknown>;
    try {
        const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as unknown;
        if (!isPlainObject(parsed)) {
            return 'Error: .bindery/settings.json is not a JSON object.';
        }
        existing = parsed;
    } catch {
        return 'Error: failed to parse .bindery/settings.json';
    }

    const safeKeys = Object.keys(args.patch).filter(k => !isUnsafeMergeKey(k));
    if (safeKeys.length === 0) {
        return 'Error: patch contains no safe keys to merge (unsafe keys like __proto__, constructor, and prototype are rejected).';
    }

    const merged = deepMergeSettings(existing, args.patch);
    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
    return `Updated .bindery/settings.json (merged keys: ${safeKeys.join(', ')}).`;
}

// ─── setup_ai_files ──────────────────────────────────────────────────────────

export interface SetupAiFilesArgs {
    targets?:   string[];   // 'claude' | 'copilot' | 'cursor' | 'agents'
    skills?:    string[];   // skill names; omit for all
    overwrite?: boolean;
}

export function toolSetupAiFiles(root: string, args: SetupAiFilesArgs): string {
    const validSkills  = new Set(ALL_SKILLS);

    const setupSettings = readSettings(root);
    // Explicit arg → saved setting → all
    const rawTargets = args.targets ?? setupSettings?.aiTargets ?? ALL_AI_TARGETS;
    const targets: AiTarget[] = rawTargets
        .filter((t): t is AiTarget => ALL_AI_TARGETS.includes(t as AiTarget));

    // Explicit arg → saved setting (only meaningful for claude) → all
    const rawSkills = args.skills ?? (targets.includes('claude') ? setupSettings?.aiSkills ?? null : null);
    const skills: SkillTemplate[] = rawSkills
        ? rawSkills.filter((s): s is SkillTemplate => validSkills.has(s as SkillTemplate))
        : ALL_SKILLS;

    if (targets.length === 0) {
        return `No valid targets specified. Valid targets: ${ALL_AI_TARGETS.join(', ')}`;
    }

    let result;
    try {
        result = setupAiFiles({ root, targets, skills, overwrite: args.overwrite ?? false });
    } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }

    // Persist chosen targets + skills so health checks and future runs use the same set
    const settingsPath = path.join(root, '.bindery', 'settings.json');
    try {
        if (fs.existsSync(settingsPath)) {
            const existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
            existing['aiTargets'] = targets;
            if (targets.includes('claude')) { existing['aiSkills'] = skills; }
            fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
        }
    } catch { /* non-fatal */ }

    const skillFilesToReupload = result.regenerated.filter(file => /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(file));

    const response = {
        regenerated_files: result.regenerated,
        skipped_files: result.skipped,
        skill_files: {
            reupload_required: skillFilesToReupload,
        },
        ai_versions: result.versionStamp,
        message: skillFilesToReupload.length > 0
            ? 'AI instruction files were generated. If you use Claude Desktop skills, re-upload these SKILL.md files in Claude Desktop: ' + skillFilesToReupload.join(', ')
            : 'AI instruction files were generated. If you use Claude Desktop skills, upload the generated SKILL.md files in Claude Desktop',
    };

    return JSON.stringify(response, null, 2);
}

// ─── memory_list ─────────────────────────────────────────────────────────────

export function toolMemoryList(root: string): string {
    const memDir = path.join(root, '.bindery', 'memories');
    if (!fs.existsSync(memDir)) { return 'No memory files found yet.'; }

    const files = fs.readdirSync(memDir, { withFileTypes: true })
        .filter(e => e.isFile() && e.name.endsWith('.md'))
        .sort((a, b) => a.name.localeCompare(b.name));

    if (files.length === 0) { return 'No memory files found yet.'; }

    return files.map(e => {
        const lineCount = fs.readFileSync(path.join(memDir, e.name), 'utf-8').split(/\r?\n/).length;
        return `${e.name}  (${lineCount} lines)`;
    }).join('\n');
}

// ─── memory_append ────────────────────────────────────────────────────────────

export interface MemoryAppendArgs {
    file:    string;
    title:   string;
    content: string;
}

export function toolMemoryAppend(root: string, args: MemoryAppendArgs): string {
    const memDir = path.join(root, '.bindery', 'memories');
    fs.mkdirSync(memDir, { recursive: true });

    const filePath  = path.join(memDir, args.file);
    const date      = new Date().toISOString().slice(0, 10);
    const header    = `## Session ${date} — ${args.title}`;
    const addition  = `\n${header}\n${args.content}`;

    fs.appendFileSync(filePath, addition, 'utf-8');

    const newTotal   = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).length;
    const addedLines = addition.split(/\r?\n/).length;

    return `Appended to ${args.file}: ${addedLines} lines added, ${newTotal} total lines.`;
}

// ─── memory_compact ───────────────────────────────────────────────────────────

export interface MemoryCompactArgs {
    file:              string;
    compacted_content: string;
}

export function toolMemoryCompact(root: string, args: MemoryCompactArgs): string {
    const memDir   = path.join(root, '.bindery', 'memories');
    const filePath = path.join(memDir, args.file);

    const oldLineCount = fs.existsSync(filePath)
        ? fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).length
        : 0;

    const archiveDir = path.join(memDir, 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });

    const date       = new Date().toISOString().slice(0, 10);
    const basename   = path.basename(args.file, '.md');
    const backupName = `${basename}_${date}.md`;
    const backupPath = path.join(archiveDir, backupName);

    if (fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, backupPath);
    }

    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(filePath, args.compacted_content, 'utf-8');

    const newLineCount = args.compacted_content.split(/\r?\n/).length;
    const relBackup    = path.join('.bindery', 'memories', 'archive', backupName);

    return `Compacted ${args.file}: backup → ${relBackup}, old lines: ${oldLineCount}, new lines: ${newLineCount}.`;
}

// ─── Session focus (SESSION.md) ─────────────────────────────────────────────────

/** Neutral SESSION.md sections that session_focus_update is allowed to touch. */
const SESSION_SECTIONS = [
    ['currentFocus',  'Current Focus'],
    ['nextActions',   'Next Actions'],
    ['openQuestions', 'Open Questions'],
    ['handoffNotes',  'Handoff Notes'],
] as const;

type SessionSectionKey = (typeof SESSION_SECTIONS)[number][0];

function sessionFilePath(root: string): string {
    return path.join(root, getSessionFile(readSettings(root) ?? null));
}

interface ParsedSection { title: string; body: string; }
interface ParsedSessionFile { preamble: string; sections: ParsedSection[]; }

/** Split a markdown file into a preamble plus ordered `## ` sections, preserving body text. */
function parseSessionFile(text: string): ParsedSessionFile {
    const lines = text.split(/\r?\n/);
    const preambleLines: string[] = [];
    const sections: ParsedSection[] = [];
    let current: { title: string; lines: string[] } | null = null;

    for (const line of lines) {
        const match = /^##\s+(.+?)\s*$/.exec(line);
        if (match) {
            if (current) { sections.push({ title: current.title, body: current.lines.join('\n').trim() }); }
            current = { title: match[1].trim(), lines: [] };
        } else if (current) {
            current.lines.push(line);
        } else {
            preambleLines.push(line);
        }
    }
    if (current) { sections.push({ title: current.title, body: current.lines.join('\n').trim() }); }
    return { preamble: preambleLines.join('\n').trim(), sections };
}

function serializeSessionFile(parsed: ParsedSessionFile): string {
    const parts: string[] = [];
    if (parsed.preamble.trim()) { parts.push(parsed.preamble.trim()); }
    for (const section of parsed.sections) {
        parts.push(`## ${section.title}${section.body ? `\n\n${section.body}` : ''}`);
    }
    return parts.join('\n\n') + '\n';
}

export function toolSessionFocusGet(root: string, args: { section?: string } = {}): string {
    const filePath = sessionFilePath(root);
    const rel = getSessionFile(readSettings(root) ?? null);
    if (!fs.existsSync(filePath)) {
        return `No session file on record at ${rel}. Run init_workspace or use session_focus_update to create it.`;
    }
    const text = fs.readFileSync(filePath, 'utf-8');
    const wanted = args.section?.trim();
    if (!wanted) { return text; }

    const parsed = parseSessionFile(text);
    const section = parsed.sections.find(s => s.title.toLowerCase() === wanted.toLowerCase());
    if (!section) {
        const titles = parsed.sections.map(s => s.title).join(', ') || '(none)';
        return `Section "${wanted}" not found in ${rel}. Available sections: ${titles}.`;
    }
    return `## ${section.title}\n\n${section.body || '(empty)'}`;
}

export interface SessionFocusUpdateArgs {
    currentFocus?: string;
    nextActions?: string;
    openQuestions?: string;
    handoffNotes?: string;
    /** 'replace' (default) overwrites a section body; 'append' adds beneath existing content. */
    mode?: 'replace' | 'append';
}

export function toolSessionFocusUpdate(root: string, args: SessionFocusUpdateArgs): string {
    const provided = SESSION_SECTIONS.filter(([key]) => {
        const value = args[key as SessionSectionKey];
        return typeof value === 'string' && value.trim().length > 0;
    });
    if (provided.length === 0) {
        return 'Error: provide at least one of currentFocus, nextActions, openQuestions, or handoffNotes.';
    }

    const filePath = sessionFilePath(root);
    const rel = getSessionFile(readSettings(root) ?? null);
    const mode = args.mode === 'append' ? 'append' : 'replace';

    let text: string;
    if (fs.existsSync(filePath)) {
        text = fs.readFileSync(filePath, 'utf-8');
    } else {
        text = cowriteSessionFile((readSettings(root) ?? {}) as Record<string, unknown>, []);
    }
    const parsed = parseSessionFile(text);

    const touched: string[] = [];
    for (const [key, title] of provided) {
        const incoming = (args[key as SessionSectionKey] as string).trim();
        let section = parsed.sections.find(s => s.title.toLowerCase() === title.toLowerCase());
        if (!section) {
            section = { title, body: '' };
            parsed.sections.push(section);
        }
        section.body = mode === 'append' && section.body
            ? `${section.body}\n\n${incoming}`
            : incoming;
        touched.push(title);
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, serializeSessionFile(parsed), 'utf-8');

    return `Session focus updated in ${rel} (${mode}): ${touched.join(', ')}.`;
}

// ─── Inbox processing (Notes/Inbox.md) ──────────────────────────────────────────

function inboxFilePath(root: string): { abs: string; rel: string } {
    const notesFolder = getNotesFolder(readSettings(root) ?? null);
    const rel = normalizeSlashes(path.posix.join(notesFolder, 'Inbox.md'));
    return { abs: path.join(root, notesFolder, 'Inbox.md'), rel };
}

interface ParsedInbox { preamble: string; items: string[]; }

/**
 * Split Inbox.md into a preamble (H1 + intro paragraph) plus discrete items.
 * Deterministic so `bindery_inbox_process` and `bindery_inbox_resolve` enumerate items identically:
 * if any `## ` headings exist the body is split on them, otherwise on blank-line blocks.
 */
function parseInboxItems(text: string): ParsedInbox {
    const lines = text.split(/\r?\n/);
    const preamble: string[] = [];
    let idx = 0;

    if (idx < lines.length && /^#\s/.test(lines[idx])) { preamble.push(lines[idx]); idx++; }
    while (idx < lines.length && lines[idx].trim() === '') { preamble.push(lines[idx]); idx++; }
    const isItemStart = (line: string): boolean =>
        /^##\s/.test(line) || /^\s*[-*+]\s/.test(line) || /^\s*\d+\.\s/.test(line);
    if (idx < lines.length && !isItemStart(lines[idx])) {
        while (idx < lines.length && lines[idx].trim() !== '') { preamble.push(lines[idx]); idx++; }
    }

    const body = lines.slice(idx).join('\n').trim();
    let items: string[] = [];
    if (body) {
        items = /^##\s/m.test(body)
            ? body.split(/(?=^##\s)/m).map(s => s.trim()).filter(Boolean)
            : body.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    }
    return { preamble: preamble.join('\n').replace(/\n+$/, ''), items };
}

function inboxItemPreview(item: string): string {
    const firstLine = (item.split('\n').find(l => l.trim()) ?? '')
        .replace(/^##\s+/, '')
        .replace(/^\s*[-*+]\s+/, '')
        .replace(/^\s*\d+\.\s+/, '')
        .trim();
    const multiline = item.split('\n').filter(l => l.trim()).length > 1;
    const clipped = firstLine.length > 100 ? firstLine.slice(0, 99) + '…' : firstLine;
    return `${clipped}${multiline ? ' …' : ''}`;
}

export function toolInboxProcess(root: string): string {
    const { abs, rel } = inboxFilePath(root);
    if (!fs.existsSync(abs)) {
        return `Inbox not found at ${rel}. Run init_workspace to create it, or add notes there first.`;
    }
    const { items } = parseInboxItems(fs.readFileSync(abs, 'utf-8'));
    if (items.length === 0) {
        return `Inbox (${rel}) is empty — only the heading/intro remain. Nothing to triage.`;
    }

    const lines: string[] = [`Inbox triage — ${items.length} item(s) in ${rel}`, ''];
    items.forEach((item, i) => {
        lines.push(`### Item ${i + 1}: ${inboxItemPreview(item)}`, '', item, '');
    });
    lines.push(
        '## How to triage',
        'Propose a destination for each item, confirm with the user, then route confirmed items with the matching tool:',
        '- Story note → `bindery_note_create` / `bindery_note_append` (World, Scenes, Research, or a custom category)',
        '- Character → `bindery_character_create` / `bindery_character_update`',
        '- Arc / structure → `bindery_arc_create` / `bindery_arc_update`',
        '- Durable cross-session decision → `bindery_memory_append`',
        '- Current focus / next action / handoff → `bindery_session_focus_update`',
        '',
        'Do not move, delete, or categorize anything without the user\'s confirmation. ' +
        'After confirmed items are routed, call `bindery_inbox_resolve` with their item numbers to remove them from the inbox. ' +
        'Items left unconfirmed stay in the inbox.',
    );
    return lines.join('\n');
}

export interface InboxResolveArgs {
    items: number[];
}

export function toolInboxResolve(root: string, args: InboxResolveArgs): string {
    const requested = Array.isArray(args.items) ? args.items : [];
    if (requested.length === 0) {
        return 'Error: provide the item numbers to remove (as shown by inbox_process).';
    }
    const { abs, rel } = inboxFilePath(root);
    if (!fs.existsSync(abs)) {
        return `Inbox not found at ${rel}. Nothing to resolve.`;
    }

    const { preamble, items } = parseInboxItems(fs.readFileSync(abs, 'utf-8'));
    const remove = new Set<number>();
    const invalid: number[] = [];
    for (const n of requested) {
        if (!Number.isInteger(n) || n < 1 || n > items.length) { invalid.push(n); }
        else { remove.add(n); }
    }
    if (invalid.length > 0) {
        return `Error: invalid item number(s): ${invalid.join(', ')}. Inbox has ${items.length} item(s); valid range is 1-${items.length}.`;
    }

    const kept = items.filter((_, i) => !remove.has(i + 1));
    const parts = [preamble.trim(), ...kept].filter(Boolean);
    fs.writeFileSync(abs, parts.join('\n\n') + '\n', 'utf-8');

    return `Resolved ${remove.size} item(s) from ${rel}; ${kept.length} remaining.`;
}

// ─── Shared formatter ─────────────────────────────────────────────────────────

function formatResult(r: SearchResult, idx: number): string {
    const snippetMax = Number.parseInt(process.env['BINDERY_SNIPPET_MAX_CHARS'] ?? '1600', 10);
    const text = r.chunk.text.length > snippetMax
        ? r.chunk.text.slice(0, snippetMax) + '…'
        : r.chunk.text;
    return [
        `[${idx}] ${r.chunk.relPath} (lines ${r.chunk.startLine}–${r.chunk.endLine}, score=${r.score.toFixed(3)}, source=${r.source})`,
        text,
    ].join('\n');
}
