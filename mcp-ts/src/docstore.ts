/**
 * Docstore — file discovery and paragraph-level chunking for a Bindery workspace.
 *
 * Mirrors the Rust docstore logic: discover story + notes files, split by blank
 * lines into chunks with stable path-based IDs.
 */

import * as fs     from 'node:fs';
import * as path   from 'node:path';
import * as crypto from 'node:crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Chunk {
    id:        string;   // sha256 of "relpath:start:end:text"
    relPath:   string;   // path relative to root
    absPath:   string;   // full fs path
    startLine: number;   // 1-based
    endLine:   number;   // 1-based, inclusive
    text:      string;
    language?: string;   // 'EN' | 'NL' | ...
}


export interface DiscoverOptions {
    language?: string;
    actName?:  string;
    chapterRange?: string;   // e.g. "5-10" or "3"
    includeArc?: boolean;
}

// ─── Discovery ───────────────────────────────────────────────────────────────

function collectStoryRoot(
    storyRoot:  string,
    langFilter: string[] | null,
    actName:    string | undefined,
    chMin:      number | null,
    chMax:      number | null,
    results:    string[]
): void {
    if (!fs.existsSync(storyRoot)) { return; }
    for (const entry of fs.readdirSync(storyRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            if (entry.isFile() && entry.name.endsWith('.md')) {
                results.push(path.join(storyRoot, entry.name));
            }
            continue;
        }
        const lang = entry.name.toUpperCase();
        if (langFilter !== null && !langFilter.includes(lang)) { continue; }
        collectStoryLang(path.join(storyRoot, entry.name), lang, actName, chMin, chMax, results);
    }
}

/**
 * Collect all .md files in the workspace that should be indexed:
 * - Story/<lang>/  (language folders, with optional act filtering)
 * - Notes/
 * - Arc/
 * - AGENTS.md / CLAUDE.md etc at Story root
 */
export function discoverFiles(root: string, opts: DiscoverOptions = {}): string[] {
    const results: string[] = [];
    const langFilter = resolvedLangs(opts.language);
    const [chMin, chMax] = parseChapterRange(opts.chapterRange);

    collectStoryRoot(path.join(root, 'Story'), langFilter, opts.actName, chMin, chMax, results);

    const notesRoot = path.join(root, 'Notes');
    if (fs.existsSync(notesRoot)) {
        collectAllMd(notesRoot, results);
    }


    if (opts.includeArc) {
        const arcRoot = path.join(root, 'Arc');
        if (fs.existsSync(arcRoot)) {
            collectAllMd(arcRoot, results);
        }
    }

    return results;
}

function collectStoryLang(
    langDir:   string,
    lang:      string,
    actFilter: string | undefined,
    chMin:     number | null,
    chMax:     number | null,
    out:       string[]
): void {
    if (!fs.existsSync(langDir)) { return; }
    for (const entry of fs.readdirSync(langDir, { withFileTypes: true })) {
        const fullPath = path.join(langDir, entry.name);
        if (entry.isFile() && entry.name.endsWith('.md')) {
            out.push(fullPath);
        } else if (entry.isDirectory()) {
            const dirName = entry.name;
            // Act folder filtering
            if (actFilter && !dirName.toLowerCase().includes(actFilter.toLowerCase())) { continue; }
            collectChapterFiles(fullPath, lang, chMin, chMax, out);
        }
    }
}

function passesRangeFilter(filename: string, chMin: number | null, chMax: number | null): boolean {
    if (chMin === null && chMax === null) { return true; }
    const num = extractChapterNumber(filename);
    if (num === null) { return true; }
    if (chMin !== null && num < chMin) { return false; }
    if (chMax !== null && num > chMax) { return false; }
    return true;
}

function collectChapterFiles(
    actDir: string,
    _lang:  string,
    chMin:  number | null,
    chMax:  number | null,
    out:    string[]
): void {
    if (!fs.existsSync(actDir)) { return; }
    for (const entry of fs.readdirSync(actDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) { continue; }
        if (passesRangeFilter(entry.name, chMin, chMax)) {
            out.push(path.join(actDir, entry.name));
        }
    }
}

function collectAllMd(dir: string, out: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectAllMd(fullPath, out);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            out.push(fullPath);
        }
    }
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

/** Split a file into paragraph-level chunks (separated by blank lines). */
export function chunkFile(absPath: string, root: string): Chunk[] {
    const relPath = path.relative(root, absPath).replaceAll('\\', '/');
    const raw     = fs.readFileSync(absPath, 'utf-8');
    const lines   = raw.split(/\r?\n/);
    const chunks: Chunk[] = [];

    // Detect language from path (Story/EN/... → "EN")
    const langMatch = /[/\\]Story[/\\]([A-Za-z]{2,3})[/\\]/.exec(relPath);
    const language  = langMatch ? langMatch[1].toUpperCase() : undefined;

    let blockStart = -1;
    let blockLines: string[] = [];

    const flush = (endIdx: number) => {
        if (blockLines.length === 0) { return; }
        const text      = blockLines.join('\n').trimEnd();
        if (!text.trim()) { return; }
        const startLine = blockStart + 1;   // 1-based
        const endLine   = endIdx;            // 1-based inclusive
        const id        = chunkId(relPath, startLine, endLine, text);
        chunks.push({ id, relPath, absPath, startLine, endLine, text, language });
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '') {
            flush(i);   // end of block (i is 1-based end of previous block… i+1 - 1 = i in 0-based)
            blockStart = -1;
            blockLines = [];
        } else {
            if (blockStart === -1) { blockStart = i; }
            blockLines.push(line);
        }
    }
    flush(lines.length);

    return chunks;
}

/** Chunk all discovered files in a workspace. */
export function chunkWorkspace(root: string, opts: DiscoverOptions = {}): Chunk[] {
    const files  = discoverFiles(root, opts);
    const chunks: Chunk[] = [];
    for (const f of files) {
        try {
            chunks.push(...chunkFile(f, root));
        } catch {
            /* skip unreadable files */
        }
    }
    return chunks;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function chunkId(relPath: string, start: number, end: number, text: string): string {
    return crypto
        .createHash('sha256')
        .update(`${relPath}:${start}:${end}:${text}`)
        .digest('hex')
        .slice(0, 16);
}

function extractChapterNumber(filename: string): number | null {
    const m = /(\d+)/.exec(filename);
    return m ? Number.parseInt(m[1], 10) : null;
}

function parseChapterRange(range: string | undefined): [number | null, number | null] {
    if (!range) { return [null, null]; }
    const parts = range.split('-');
    const min   = Number.parseInt(parts[0], 10);
    const max   = parts.length > 1 ? Number.parseInt(parts[1], 10) : min;
    return [Number.isNaN(min) ? null : min, Number.isNaN(max) ? null : max];
}

function resolvedLangs(language: string | undefined): string[] | null {
    if (!language || language === 'ALL') { return null; }
    return [language.toUpperCase()];
}
