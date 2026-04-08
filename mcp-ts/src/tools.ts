/**
 * MCP tool implementations for Bindery.
 *
 * Each exported function corresponds to one MCP tool.
 * All functions receive `root: string` (resolved workspace root) plus
 * tool-specific arguments, and return a plain string (tool result content).
 */

import * as fs   from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { updateTypography }                 from './format.js';
import { chunkFile, discoverFiles, type Language } from './docstore.js';
import {
    buildIndex, loadIndex, indexPath, search, rerank,
    type SearchResult,
} from './search.js';
import {
    setupAiFiles,
    ALL_SKILLS,
    readAiVersionFile,
    expectedAiVersionEntries,
    type AiTarget,
    type SkillTemplate,
} from './aisetup.js';

// ─── Shared helpers ───────────────────────────────────────────────────────────

function readJson<T>(filePath: string): T | null {
    if (!fs.existsSync(filePath)) { return null; }
    try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T; }
    catch { return null; }
}

interface Settings {
    storyFolder?: string;
    author?: string;
    bookTitle?: string | Record<string, string>;
    languages?: Array<{ code: string; folderName: string; chapterWord: string; actPrefix: string; prologueLabel: string; epilogueLabel: string }>;
}

function readSettings(root: string): Settings | null {
    return readJson<Settings>(path.join(root, '.bindery', 'settings.json'));
}

function storyFolder(root: string): string {
    return readSettings(root)?.storyFolder ?? 'Story';
}

// ─── health ───────────────────────────────────────────────────────────────────

export function toolHealth(root: string): string {
    const settingsPath = path.join(root, '.bindery', 'settings.json');
    const settingsStatus = fs.existsSync(settingsPath)
        ? 'present'
        : 'missing — run init_workspace to set up this book';

    const memDir   = path.join(root, '.bindery', 'memories');
    const memFiles = fs.existsSync(memDir)
        ? fs.readdirSync(memDir).filter(f => f.endsWith('.md')).length
        : -1;
    const memoriesStatus = memFiles >= 0
        ? `present (${memFiles} file${memFiles === 1 ? '' : 's'})`
        : 'not created yet';

    const idxPath = indexPath(root);
    let indexStatus = 'not built — run index_build first';
    if (fs.existsSync(idxPath)) {
        const raw = readJson<{ meta?: { builtAt?: string; chunkCount?: number } }>(idxPath);
        indexStatus = `present (chunks=${raw?.meta?.chunkCount ?? '?'}, built=${raw?.meta?.builtAt ?? '?'})`;
    }

    const ollamaUrl = process.env['BINDERY_OLLAMA_URL'];
    const embeddingsStatus = ollamaUrl
        ? `ollama at ${ollamaUrl}`
        : 'BM25 only (set BINDERY_OLLAMA_URL for reranking)';

    const installed = readAiVersionFile(root);
    const expected = expectedAiVersionEntries();
    const aiVersionsOutdated: Array<{ file: string; label: string; zip: string | null; expected: number; found: number }> = [];

    for (const [file, exp] of Object.entries(expected)) {
        if (!fs.existsSync(path.join(root, file))) { continue; }
        const found = installed.versions[file]?.version ?? 0;
        if (found < exp.version) {
            aiVersionsOutdated.push({
                file,
                label: exp.label,
                zip: exp.zip,
                expected: exp.version,
                found,
            });
        }
    }

    const response = {
        root,
        settings: settingsStatus,
        memories: memoriesStatus,
        index: indexStatus,
        embeddings: embeddingsStatus,
        ai_version_outdated: aiVersionsOutdated.length > 0,
        ai_versions_outdated: aiVersionsOutdated,
        message: aiVersionsOutdated.length > 0
            ? 'AI instruction files are out of date. Run setup_ai_files, then re-upload any listed skill zip files in Claude Desktop.'
            : 'AI instruction files are up to date.',
    };

    return JSON.stringify(response, null, 2);
}

// ─── index_build ─────────────────────────────────────────────────────────────

export function toolIndexBuild(root: string): string {
    const { meta } = buildIndex(root);
    return `Index built: ${meta.chunkCount} chunks, ${new Date(meta.builtAt).toLocaleString()}`;
}

// ─── index_status ─────────────────────────────────────────────────────────────

export function toolIndexStatus(root: string): string {
    const p = indexPath(root);
    if (!fs.existsSync(p)) { return 'No index found. Run index_build first.'; }
    const raw = readJson<{ meta?: { builtAt?: string; chunkCount?: number; root?: string } }>(p);
    if (!raw?.meta) { return 'Index file exists but metadata is unreadable.'; }
    return [
        `chunks: ${raw.meta.chunkCount ?? '?'}`,
        `built:  ${raw.meta.builtAt ?? '?'}`,
        `root:   ${raw.meta.root ?? '?'}`,
    ].join('\n');
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

function findChapterFile(dir: string, num: number): string | null {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const found = findChapterFile(fullPath, num);
            if (found) { return found; }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const m = /(?:chapter|hoofdstuk|chapter_?)\s*(\d+)/i.exec(entry.name);
            if (m && parseInt(m[1], 10) === num) { return fullPath; }
        }
    }
    return null;
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
        lines.push(`## ${lang}`);
        lines.push(...overviewForLang(langDir, args.act));
        lines.push('');
    }

    return lines.join('\n') || 'No language folders found.';
}

function overviewForLang(langDir: string, actFilter?: number): string[] {
    const lines: string[] = [];
    const entries = fs.readdirSync(langDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name));

    for (const actEntry of entries) {
        const actNum = parseActNumber(actEntry.name);
        if (actFilter !== undefined && actNum !== null && actNum !== actFilter) { continue; }
        lines.push(`### ${actEntry.name}`);
        const actDir = path.join(langDir, actEntry.name);
        const chapters = fs.readdirSync(actDir, { withFileTypes: true })
            .filter(e => e.isFile() && e.name.endsWith('.md'))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        for (const ch of chapters) {
            const fullPath = path.join(actDir, ch.name);
            const firstLine = firstH1(fullPath);
            lines.push(`- ${ch.name}${firstLine ? ': ' + firstLine : ''}`);
        }
    }

    // Top-level .md files (prologue, epilogue)
    const topLevel = fs.readdirSync(langDir, { withFileTypes: true })
        .filter(e => e.isFile() && e.name.endsWith('.md'));
    if (topLevel.length > 0 && actFilter === undefined) {
        lines.push('### Top-level');
        for (const f of topLevel) {
            const firstLine = firstH1(path.join(langDir, f.name));
            lines.push(`- ${f.name}${firstLine ? ': ' + firstLine : ''}`);
        }
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

export function toolGetNotes(root: string, args: GetNotesArgs): string {
    const notesDir = path.join(root, 'Notes');
    const candidates: string[] = [];

    if (fs.existsSync(notesDir)) {
        collectAllMd(notesDir, candidates);
    }
    // Also Details_*.md files at root
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isFile() && /^Details_.*\.md$/i.test(entry.name)) {
            candidates.push(path.join(root, entry.name));
        }
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
            // Extract sections containing the name
            const sections = content.split(/^#{1,3}\s+/m);
            for (const section of sections) {
                if (section.toLowerCase().includes(nameFilter)) {
                    results.push(section.trim());
                }
            }
        } else {
            results.push(`## ${path.basename(filePath)}\n\n${content}`);
        }
    }

    return results.join('\n\n---\n\n') || 'No matching notes found.';
}

function collectAllMd(dir: string, out: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) { collectAllMd(fullPath, out); }
        else if (entry.isFile() && entry.name.endsWith('.md')) { out.push(fullPath); }
    }
}

// ─── search ───────────────────────────────────────────────────────────────────

export interface SearchArgs {
    query:          string;
    language?:      string;
    maxResults?:    number;
    caseSensitive?: boolean;
}

export async function toolSearch(root: string, args: SearchArgs): Promise<string> {
    const topK     = args.maxResults ?? 10;
    const language = args.language?.toUpperCase() as Language | undefined;

    let idxData = loadIndex(root);
    if (!idxData) {
        idxData = buildIndex(root);
    }

    let results = search(idxData.ms, idxData.chunks, args.query, topK * 3, language);

    // Optional Ollama reranking
    if (process.env['BINDERY_OLLAMA_URL']) {
        results = await rerank(results, args.query);
    }

    results = results.slice(0, topK);

    if (results.length === 0) { return 'No results found.'; }

    return results.map((r, i) => formatResult(r, i + 1)).join('\n\n---\n\n');
}

// ─── retrieve_context ─────────────────────────────────────────────────────────

export interface RetrieveArgs {
    query:     string;
    language?: string;
    topK?:     number;
}

export async function toolRetrieveContext(root: string, args: RetrieveArgs): Promise<string> {
    const topK     = args.topK ?? parseInt(process.env['BINDERY_DEFAULT_TOPK'] ?? '6', 10);
    const language = args.language?.toUpperCase() as Language | undefined;

    let idxData = loadIndex(root);
    if (!idxData) {
        idxData = buildIndex(root);
    }

    let results = search(idxData.ms, idxData.chunks, args.query, topK * 4, language);

    if (process.env['BINDERY_OLLAMA_URL']) {
        results = await rerank(results, args.query);
    }

    results = results.slice(0, topK);

    if (results.length === 0) { return 'No context found.'; }

    const maxBytes = parseInt(process.env['BINDERY_MAX_RESPONSE_BYTES'] ?? '60000', 10);
    const parts: string[] = [];
    let total = 0;

    for (let i = 0; i < results.length; i++) {
        const fragment = formatResult(results[i], i + 1);
        if (total + fragment.length > maxBytes) { break; }
        parts.push(fragment);
        total += fragment.length;
    }

    return parts.join('\n\n---\n\n');
}

// ─── format ───────────────────────────────────────────────────────────────────

export interface FormatArgs {
    filePath?:  string;
    dryRun?:    boolean;
    noRecurse?: boolean;
}

export function toolFormat(root: string, args: FormatArgs): string {
    const target = args.filePath
        ? path.isAbsolute(args.filePath) ? args.filePath : path.join(root, args.filePath)
        : root;

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

interface DiffFile {
    file: string;
    hunks: DiffHunk[];
}

interface DiffHunk {
    beforeStart: number;
    beforeCount: number;
    afterStart:  number;
    afterCount:  number;
    lines: DiffLine[];
}

interface DiffLine {
    type: 'context' | 'insert' | 'delete';
    text: string;
    oldLine?: number;
    newLine?: number;
}

export function toolGetReviewText(root: string, args: GetReviewTextArgs): string {
    const contextLines = args.contextLines ?? 3;
    const language     = (args.language ?? 'ALL').toUpperCase();

    let raw: string;
    try {
        const result = spawnSync(
            'git', ['diff', '--ignore-cr-at-eol', `-U${contextLines}`],
            { cwd: root, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
        );
        if (result.error) { throw result.error; }
        raw = result.stdout;
    } catch {
        return 'Failed to run git diff. Is this a git repository?';
    }

    if (!raw.trim()) { return 'No uncommitted changes.'; }

    const files = parseUnifiedDiff(raw);

    const filtered = language === 'ALL'
        ? files
        : files.filter(f => {
            const upper = f.file.toUpperCase().replace(/\\/g, '/');
            return upper.includes(`/${language}/`);
        });

    if (filtered.length === 0) {
        return language === 'ALL'
            ? 'No uncommitted changes.'
            : `No uncommitted changes in ${language} files.`;
    }

    const result = formatReviewFiles(filtered);

    // Stage reviewed files so the next review only shows new changes
    if (args.autoStage) {
        const contentDirs = contentFolders(root);
        try {
            const result = spawnSync('git', ['add', ...contentDirs], { cwd: root, encoding: 'utf-8' });
            if (result.error) { throw result.error; }
        } catch { /* best effort — staging failure shouldn't break the review */ }
    }

    return result;
}

/** Content folders that git operations should scope to. */
function contentFolders(root: string): string[] {
    const story = storyFolder(root);
    return [story, 'Notes', 'Arc'].filter(d => fs.existsSync(path.join(root, d)));
}

// ─── git_snapshot ─────────────────────────────────────────────────────────────

export interface GitSnapshotArgs {
    message?: string;
}

export function toolGitSnapshot(root: string, args: GitSnapshotArgs): string {
    const dirs = contentFolders(root);
    if (dirs.length === 0) { return 'No content folders found to snapshot.'; }

    // Stage content folders
    try {
        const result = spawnSync('git', ['add', ...dirs], { cwd: root, encoding: 'utf-8' });
        if (result.error) { throw result.error; }
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

    if (!staged.trim()) { return 'Nothing to snapshot — no changes in content folders.'; }

    const fileCount = staged.trim().split('\n').length;
    const msg       = args.message ?? `Snapshot ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

    try {
        const result = spawnSync('git', ['commit', '-m', msg], { cwd: root, encoding: 'utf-8' });
        if (result.error) { throw result.error; }
        if (result.status !== 0) { throw new Error(result.stderr || 'git commit failed'); }
    } catch (e) {
        return `Failed to commit: ${e instanceof Error ? e.message : String(e)}`;
    }

    return `Snapshot saved: "${msg}" (${fileCount} file${fileCount === 1 ? '' : 's'})`;
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
            .map(([k, e]) => `${k}${e.label ? ` (${e.label})` : ''}`)
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
        const header = `${matchedKey}${entry.label ? ` — ${entry.label}` : ''} (${entry.type}, ${rules.length} rules):`;
        return [header, ...rules.map(r => `  ${r.from}  →  ${r.to}`)].join('\n');
    }

    const stems = wordStems(args.word.toLowerCase());
    const matches = rules.filter(r => stems.some(s => r.from.toLowerCase() === s));
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

interface TranslationRule  { from: string; to: string }
interface TranslationEntry { label?: string; type: string; sourceLanguage?: string; rules?: TranslationRule[]; ignoredWords?: string[] }
type TranslationsFile = Record<string, TranslationEntry>;

// ─── Built-in en-gb substitution rules (US → British English) ────────────────

const BUILTIN_EN_GB_RULES: TranslationRule[] = [
    { from: 'analyze',        to: 'analyse' },
    { from: 'analyzes',       to: 'analyses' },
    { from: 'analyzed',       to: 'analysed' },
    { from: 'analyzing',      to: 'analysing' },
    { from: 'canceled',       to: 'cancelled' },
    { from: 'canceling',      to: 'cancelling' },
    { from: 'center',         to: 'centre' },
    { from: 'centers',        to: 'centres' },
    { from: 'centered',       to: 'centred' },
    { from: 'centering',      to: 'centring' },
    { from: 'color',          to: 'colour' },
    { from: 'colors',         to: 'colours' },
    { from: 'colored',        to: 'coloured' },
    { from: 'coloring',       to: 'colouring' },
    { from: 'defense',        to: 'defence' },
    { from: 'destabilize',    to: 'destabilise' },
    { from: 'destabilizes',   to: 'destabilises' },
    { from: 'destabilized',   to: 'destabilised' },
    { from: 'destabilizing',  to: 'destabilising' },
    { from: 'equalize',       to: 'equalise' },
    { from: 'equalizes',      to: 'equalises' },
    { from: 'equalized',      to: 'equalised' },
    { from: 'equalizing',     to: 'equalising' },
    { from: 'favor',          to: 'favour' },
    { from: 'favors',         to: 'favours' },
    { from: 'favored',        to: 'favoured' },
    { from: 'favoring',       to: 'favouring' },
    { from: 'favorite',       to: 'favourite' },
    { from: 'favorites',      to: 'favourites' },
    { from: 'fiber',          to: 'fibre' },
    { from: 'gray',           to: 'grey' },
    { from: 'initialize',     to: 'initialise' },
    { from: 'initializes',    to: 'initialises' },
    { from: 'initialized',    to: 'initialised' },
    { from: 'initializing',   to: 'initialising' },
    { from: 'mesmerize',      to: 'mesmerise' },
    { from: 'mesmerizes',     to: 'mesmerises' },
    { from: 'mesmerized',     to: 'mesmerised' },
    { from: 'mesmerizing',    to: 'mesmerising' },
    { from: 'mom',            to: 'mum' },
    { from: 'offense',        to: 'offence' },
    { from: 'organize',       to: 'organise' },
    { from: 'organizes',      to: 'organises' },
    { from: 'organized',      to: 'organised' },
    { from: 'organizing',     to: 'organising' },
    { from: 'organization',   to: 'organisation' },
    { from: 'realize',        to: 'realise' },
    { from: 'realizes',       to: 'realises' },
    { from: 'realized',       to: 'realised' },
    { from: 'realizing',      to: 'realising' },
    { from: 'realization',    to: 'realisation' },
    { from: 'recognize',      to: 'recognise' },
    { from: 'recognizes',     to: 'recognises' },
    { from: 'recognized',     to: 'recognised' },
    { from: 'recognizing',    to: 'recognising' },
    { from: 'specialize',     to: 'specialise' },
    { from: 'specializes',    to: 'specialises' },
    { from: 'specialized',    to: 'specialised' },
    { from: 'specializing',   to: 'specialising' },
    { from: 'theater',        to: 'theatre' },
    { from: 'theaters',       to: 'theatres' },
    { from: 'traveler',       to: 'traveller' },
    { from: 'travelers',      to: 'travellers' },
    { from: 'traveled',       to: 'travelled' },
    { from: 'traveling',      to: 'travelling' },
];

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
        const header = `${key}${entry.label ? ` — ${entry.label}` : ''} (${rules.length} substitution rules):`;
        return [header, ...rules.map(r => `  ${r.from}  →  ${r.to}`)].join('\n');
    }

    const stems   = wordStems(args.word.toLowerCase());
    const matches = rules.filter(r => stems.some(s => r.from.toLowerCase() === s));
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

function parseUnifiedDiff(raw: string): DiffFile[] {
    const files: DiffFile[] = [];
    const fileChunks = raw.split(/^diff --git /m).filter(Boolean);

    for (const chunk of fileChunks) {
        const nameMatch = /^a\/(.+?)\s+b\/(.+)/m.exec(chunk);
        if (!nameMatch) { continue; }
        const fileName = nameMatch[2];

        const hunks: DiffHunk[] = [];
        const hunkParts = chunk.split(/^@@\s+/m).slice(1);

        for (const hunkPart of hunkParts) {
            const headerMatch = /^-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)/.exec(hunkPart);
            if (!headerMatch) { continue; }

            const beforeStart = parseInt(headerMatch[1], 10);
            const beforeCount = headerMatch[2] !== undefined ? parseInt(headerMatch[2], 10) : 1;
            const afterStart  = parseInt(headerMatch[3], 10);
            const afterCount  = headerMatch[4] !== undefined ? parseInt(headerMatch[4], 10) : 1;

            const body = headerMatch[5] + '\n' + hunkPart.slice(headerMatch[0].length);
            const bodyLines = body.split('\n');

            const lines: DiffLine[] = [];
            let oldLine = beforeStart;
            let newLine = afterStart;

            for (const line of bodyLines) {
                if (line.startsWith('+')) {
                    lines.push({ type: 'insert', text: line.slice(1), newLine: newLine });
                    newLine++;
                } else if (line.startsWith('-')) {
                    lines.push({ type: 'delete', text: line.slice(1), oldLine: oldLine });
                    oldLine++;
                } else if (line.startsWith(' ') || line === '') {
                    // context line — but skip trailing empty from split
                    if (line.startsWith(' ')) {
                        lines.push({ type: 'context', text: line.slice(1), oldLine: oldLine, newLine: newLine });
                        oldLine++;
                        newLine++;
                    }
                }
            }

            hunks.push({ beforeStart, beforeCount, afterStart, afterCount, lines });
        }

        files.push({ file: fileName, hunks });
    }

    return files;
}

function formatReviewFiles(files: DiffFile[]): string {
    const parts: string[] = [];

    for (const file of files) {
        const lines: string[] = [`## ${file.file}`];

        for (const hunk of file.hunks) {
            lines.push(`\n@@ -${hunk.beforeStart},${hunk.beforeCount} +${hunk.afterStart},${hunk.afterCount} @@`);
            for (const l of hunk.lines) {
                const prefix = l.type === 'insert' ? '+' : l.type === 'delete' ? '-' : ' ';
                lines.push(`${prefix} ${l.text}`);
            }
        }

        parts.push(lines.join('\n'));
    }

    return parts.join('\n\n---\n\n');
}

// ─── init_workspace ──────────────────────────────────────────────────────────

export interface InitWorkspaceArgs {
    bookTitle?:      string;
    author?:         string;
    storyFolder?:    string;
    genre?:          string;
    description?:    string;
    targetAudience?: string;
}

export function toolInitWorkspace(root: string, args: InitWorkspaceArgs): string {
    const settingsPath     = path.join(root, '.bindery', 'settings.json');
    const translationsPath = path.join(root, '.bindery', 'translations.json');

    // Load existing settings to preserve any keys not being updated
    let existing: Record<string, unknown> = {};
    const isNew = !fs.existsSync(settingsPath);
    if (!isNew) {
        try { existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>; }
        catch { /* corrupt — treat as new */ }
    }

    const storyFolderName = args.storyFolder ?? (existing['storyFolder'] as string | undefined) ?? 'Story';
    const bookTitle       = args.bookTitle   ?? (existing['bookTitle']   as string | undefined) ?? path.basename(root);

    // Detect language folders from the story directory
    const storyPath = path.join(root, storyFolderName);
    const detectedLangs: Array<{ code: string; folderName: string; chapterWord: string; actPrefix: string; prologueLabel: string; epilogueLabel: string }> = [];
    if (fs.existsSync(storyPath)) {
        for (const entry of fs.readdirSync(storyPath, { withFileTypes: true })) {
            if (entry.isDirectory() && /^[A-Z]{2,3}$/i.test(entry.name)) {
                const code = entry.name.toUpperCase();
                detectedLangs.push({ code, folderName: entry.name, chapterWord: 'Chapter', actPrefix: 'Act', prologueLabel: 'Prologue', epilogueLabel: 'Epilogue' });
            }
        }
    }
    // Merge detected langs with existing to preserve custom properties (dialects, isDefault, labels)
    const existingLangs = ((existing['languages'] as unknown[] | undefined) ?? []) as Array<Record<string, unknown>>;
    const baseLangs = detectedLangs.length > 0
        ? detectedLangs
        : [{ code: 'EN', folderName: 'EN', chapterWord: 'Chapter', actPrefix: 'Act', prologueLabel: 'Prologue', epilogueLabel: 'Epilogue' }];
    const languages: Array<Record<string, unknown>> = baseLangs.map(dl => {
        const el = existingLangs.find(l => (l['code'] as string | undefined)?.toUpperCase() === dl.code);
        return el ? { ...el, code: dl.code, folderName: dl.folderName } : (dl as unknown as Record<string, unknown>);
    });

    const slug = bookTitle.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/, '') || 'Book';
    const settings: Record<string, unknown> = {
        ...existing,
        bookTitle,
        ...(args.author         ? { author: args.author }                : {}),
        ...(args.genre          ? { genre: args.genre }                  : {}),
        ...(args.description    ? { description: args.description }      : {}),
        ...(args.targetAudience ? { targetAudience: args.targetAudience }: {}),
        storyFolder:     storyFolderName,
        mergedOutputDir: (existing['mergedOutputDir'] as string | undefined)  ?? 'Merged',
        mergeFilePrefix: (existing['mergeFilePrefix'] as string | undefined)  ?? slug,
        formatOnSave:    (existing['formatOnSave']    as boolean | undefined) ?? false,
        languages,
    };

    fs.mkdirSync(path.join(root, '.bindery'), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    const created: string[] = ['.bindery/settings.json'];

    // Create translations.json only if it does not already exist
    if (!fs.existsSync(translationsPath)) {
        const translations = {
            'en-gb': { label: 'British English', type: 'substitution', sourceLanguage: 'en', rules: [], ignoredWords: [] },
        };
        fs.writeFileSync(translationsPath, JSON.stringify(translations, null, 2) + '\n', 'utf-8');
        created.push('.bindery/translations.json');
    }

    // Seed en-gb rules if any language declares it as a dialect and it isn't already populated
    type LangWithDialects = { dialects?: Array<{ code: string }> };
    const engbDeclared = languages.some((l: unknown) =>
        (l as LangWithDialects).dialects?.some(d => d.code?.toLowerCase() === 'en-gb')
    );
    let engbSeeded = false;
    if (engbDeclared) {
        let trans: TranslationsFile = {};
        if (fs.existsSync(translationsPath)) {
            try { trans = JSON.parse(fs.readFileSync(translationsPath, 'utf-8')) as TranslationsFile; } catch { /* ignore */ }
        }
        if (!trans['en-gb']?.rules?.length) {
            trans['en-gb'] = { label: 'British English', type: 'substitution', sourceLanguage: 'en', rules: BUILTIN_EN_GB_RULES, ignoredWords: [] };
            fs.writeFileSync(translationsPath, JSON.stringify(trans, null, 2) + '\n', 'utf-8');
            engbSeeded = true;
        }
    }

    const action   = isNew ? 'Initialised' : 'Updated';
    const langNote = languages.map(l => (l as { code: string }).code).join(', ');
    const hint     = isNew
        ? '\n\nTip: AI instruction files (CLAUDE.md, skills, copilot-instructions.md) are not yet set up. Run setup_ai_files to generate them, or use "Bindery: Set Up AI Files" in VS Code.'
        : '';
    const engbNote = engbSeeded ? ' en-gb dialect seeded (75 rules).' : '';
    return `${action}: ${created.join(', ')}. Book: "${bookTitle}", story folder: ${storyFolderName}/, languages: ${langNote}.${engbNote}${hint}`;
}

// ─── setup_ai_files ──────────────────────────────────────────────────────────

export interface SetupAiFilesArgs {
    targets?:   string[];   // 'claude' | 'copilot' | 'cursor' | 'agents'
    skills?:    string[];   // skill names; omit for all
    overwrite?: boolean;
}

export function toolSetupAiFiles(root: string, args: SetupAiFilesArgs): string {
    const validTargets: AiTarget[] = ['claude', 'copilot', 'cursor', 'agents'];
    const validSkills  = new Set(ALL_SKILLS);

    const targets: AiTarget[] = (args.targets ?? validTargets)
        .filter((t): t is AiTarget => validTargets.includes(t as AiTarget));

    const skills: SkillTemplate[] = args.skills
        ? args.skills.filter((s): s is SkillTemplate => validSkills.has(s as SkillTemplate))
        : ALL_SKILLS;

    if (targets.length === 0) {
        return `No valid targets specified. Valid targets: ${validTargets.join(', ')}`;
    }

    let result;
    try {
        result = setupAiFiles({ root, targets, skills, overwrite: args.overwrite ?? false });
    } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }

    const zipToUpload = [
        ...result.skillZipManifest.created,
        ...result.skillZipManifest.rebuilt,
    ];

    const response = {
        regenerated_files: result.regenerated,
        skipped_files: result.skipped,
        skill_zips: {
            created: result.skillZipManifest.created,
            rebuilt: result.skillZipManifest.rebuilt,
            skipped: result.skillZipManifest.skipped,
            failed: result.skillZipManifest.failed,
            reupload_required: zipToUpload,
        },
        ai_versions: result.versionStamp,
        message:
            'If you are using Claude Desktop as AI assistant, re-upload these skill zips via Customize -> Skills: ' +
            (zipToUpload.length > 0 ? zipToUpload.join(', ') : 'none'),
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

// ─── chapter_status_get / chapter_status_update ───────────────────────────────

export interface ChapterStatusEntry {
    number:      number;
    title:       string;
    language:    string;
    status:      'done' | 'in-progress' | 'draft' | 'planned' | 'needs-review';
    wordCount?:  number;
    notes?:      string;
}

interface ChapterStatus {
    schemaVersion: 1;
    updatedAt:     string;
    chapters:      ChapterStatusEntry[];
}

const STATUS_ORDER  = ['done', 'in-progress', 'needs-review', 'draft', 'planned'] as const;
const STATUS_LABELS: Record<string, string> = {
    'done':         'Done',
    'in-progress':  'In Progress',
    'needs-review': 'Needs Review',
    'draft':        'Draft',
    'planned':      'Planned',
};

export function toolChapterStatusGet(root: string): string {
    const filePath = path.join(root, '.bindery', 'chapter-status.json');
    if (!fs.existsSync(filePath)) {
        return 'No chapter status on record. Use chapter_status_update to record progress.';
    }
    let data: ChapterStatus;
    try { data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ChapterStatus; }
    catch { return 'Error: .bindery/chapter-status.json is present but cannot be parsed.'; }

    const chapters = (data.chapters ?? []).slice().sort((a, b) => a.number - b.number);
    if (chapters.length === 0) {
        return 'No chapters recorded. Use chapter_status_update to record progress.';
    }

    const byStatus = new Map<string, ChapterStatusEntry[]>();
    for (const ch of chapters) {
        const list = byStatus.get(ch.status) ?? [];
        list.push(ch);
        byStatus.set(ch.status, list);
    }

    const lines: string[] = [`Chapter status — updated ${data.updatedAt}, ${chapters.length} chapter(s)`];
    for (const status of STATUS_ORDER) {
        const group = byStatus.get(status);
        if (!group || group.length === 0) { continue; }
        lines.push(`\n${STATUS_LABELS[status]} (${group.length})`);
        for (const ch of group) {
            const meta: string[] = [];
            if (ch.language !== 'EN') { meta.push(ch.language); }
            if (ch.wordCount)         { meta.push(`~${ch.wordCount}w`); }
            const suffix = meta.length ? ` [${meta.join(', ')}]` : '';
            lines.push(`  Ch ${ch.number} — ${ch.title}${suffix}`);
            if (ch.notes) { lines.push(`    ${ch.notes}`); }
        }
    }
    return lines.join('\n');
}

export interface ChapterStatusUpdateArgs {
    chapters: ChapterStatusEntry[];
}

export function toolChapterStatusUpdate(root: string, args: ChapterStatusUpdateArgs): string {
    if (!args.chapters || args.chapters.length === 0) {
        return 'Error: chapters array must not be empty.';
    }
    const filePath = path.join(root, '.bindery', 'chapter-status.json');
    let data: ChapterStatus = { schemaVersion: 1, updatedAt: '', chapters: [] };
    if (fs.existsSync(filePath)) {
        try { data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ChapterStatus; }
        catch { /* corrupt — start fresh */ }
    }

    const chapters = data.chapters ?? [];
    let added = 0, updated = 0;
    for (const incoming of args.chapters) {
        const lang  = (incoming.language ?? 'EN').toUpperCase();
        const entry = { ...incoming, language: lang };
        const idx   = chapters.findIndex(c => c.number === entry.number && c.language === lang);
        if (idx >= 0) { chapters[idx] = entry; updated++; }
        else           { chapters.push(entry);  added++;   }
    }

    chapters.sort((a, b) => a.language.localeCompare(b.language) || a.number - b.number);

    const out: ChapterStatus = {
        schemaVersion: 1,
        updatedAt:     new Date().toISOString().slice(0, 10),
        chapters,
    };

    fs.mkdirSync(path.join(root, '.bindery'), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(out, null, 2) + '\n', 'utf-8');

    return `Chapter status updated: ${added} added, ${updated} updated. Total: ${chapters.length} chapters.`;
}

// ─── Shared formatter ─────────────────────────────────────────────────────────

function formatResult(r: SearchResult, idx: number): string {
    const snippetMax = parseInt(process.env['BINDERY_SNIPPET_MAX_CHARS'] ?? '1600', 10);
    const text = r.chunk.text.length > snippetMax
        ? r.chunk.text.slice(0, snippetMax) + '…'
        : r.chunk.text;
    return [
        `[${idx}] ${r.chunk.relPath} (lines ${r.chunk.startLine}–${r.chunk.endLine}, score=${r.score.toFixed(3)}, source=${r.source})`,
        text,
    ].join('\n');
}
