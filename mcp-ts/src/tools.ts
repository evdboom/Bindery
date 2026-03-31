/**
 * MCP tool implementations for Bindery.
 *
 * Each exported function corresponds to one MCP tool.
 * All functions receive `root: string` (resolved workspace root) plus
 * tool-specific arguments, and return a plain string (tool result content).
 */

import * as fs   from 'fs';
import * as path from 'path';
import { updateTypography }                 from './format.js';
import { chunkFile, discoverFiles, type Language } from './docstore.js';
import {
    buildIndex, loadIndex, indexPath, search, rerank,
    type SearchResult,
} from './search.js';

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
    const lines: string[] = [`root: ${root}`];

    const settingsPath = path.join(root, '.bindery', 'settings.json');
    lines.push(`settings.json: ${fs.existsSync(settingsPath) ? 'present' : 'missing'}`);

    const idxPath = indexPath(root);
    if (fs.existsSync(idxPath)) {
        const raw = readJson<{ meta?: { builtAt?: string; chunkCount?: number } }>(idxPath);
        lines.push(`index: present (chunks=${raw?.meta?.chunkCount ?? '?'}, built=${raw?.meta?.builtAt ?? '?'})`);
    } else {
        lines.push('index: not built — run index_build first');
    }

    const ollamaUrl = process.env['BINDERY_OLLAMA_URL'];
    lines.push(`embeddings: ${ollamaUrl ? `ollama at ${ollamaUrl}` : 'BM25 only (set BINDERY_OLLAMA_URL for reranking)'}`);

    return lines.join('\n');
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
    // Try as relative path first, then search in story folder
    const candidates = [
        path.join(root, args.identifier),
        path.join(root, storyFolder(root), args.identifier),
    ];

    let filePath: string | null = null;
    for (const c of candidates) {
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
