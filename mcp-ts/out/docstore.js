"use strict";
/**
 * Docstore — file discovery and paragraph-level chunking for a Bindery workspace.
 *
 * Mirrors the Rust docstore logic: discover story + notes files, split by blank
 * lines into chunks with stable path-based IDs.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.discoverFiles = discoverFiles;
exports.chunkFile = chunkFile;
exports.chunkWorkspace = chunkWorkspace;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
// ─── Discovery ───────────────────────────────────────────────────────────────
/**
 * Collect all .md files in the workspace that should be indexed:
 * - Story/<lang>/  (language folders, with optional act filtering)
 * - Notes/
 * - Details_*.md at root
 * - AGENTS.md / CLAUDE.md etc at Story root
 */
function discoverFiles(root, opts = {}) {
    const results = [];
    const storyRoot = path.join(root, 'Story');
    const langFilter = resolvedLangs(opts.language);
    const [chMin, chMax] = parseChapterRange(opts.chapterRange);
    // Story language folders
    if (fs.existsSync(storyRoot)) {
        for (const entry of fs.readdirSync(storyRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) {
                if (entry.isFile() && entry.name.endsWith('.md')) {
                    results.push(path.join(storyRoot, entry.name));
                }
                continue;
            }
            const lang = entry.name.toUpperCase();
            if (langFilter !== null && !langFilter.includes(lang)) {
                continue;
            }
            collectStoryLang(path.join(storyRoot, entry.name), lang, opts.actName, chMin, chMax, results);
        }
    }
    // Notes folder
    const notesRoot = path.join(root, 'Notes');
    if (fs.existsSync(notesRoot)) {
        collectAllMd(notesRoot, results);
    }
    // Details_*.md at workspace root
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isFile() && /^Details_.*\.md$/i.test(entry.name)) {
            results.push(path.join(root, entry.name));
        }
    }
    return results;
}
function collectStoryLang(langDir, lang, actFilter, chMin, chMax, out) {
    if (!fs.existsSync(langDir)) {
        return;
    }
    for (const entry of fs.readdirSync(langDir, { withFileTypes: true })) {
        const fullPath = path.join(langDir, entry.name);
        if (entry.isFile() && entry.name.endsWith('.md')) {
            out.push(fullPath);
        }
        else if (entry.isDirectory()) {
            const dirName = entry.name;
            // Act folder filtering
            if (actFilter && !dirName.toLowerCase().includes(actFilter.toLowerCase())) {
                continue;
            }
            collectChapterFiles(fullPath, lang, chMin, chMax, out);
        }
    }
}
function collectChapterFiles(actDir, _lang, chMin, chMax, out) {
    if (!fs.existsSync(actDir)) {
        return;
    }
    for (const entry of fs.readdirSync(actDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) {
            continue;
        }
        if (chMin !== null || chMax !== null) {
            const num = extractChapterNumber(entry.name);
            if (num !== null) {
                if (chMin !== null && num < chMin) {
                    continue;
                }
                if (chMax !== null && num > chMax) {
                    continue;
                }
            }
        }
        out.push(path.join(actDir, entry.name));
    }
}
function collectAllMd(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectAllMd(fullPath, out);
        }
        else if (entry.isFile() && entry.name.endsWith('.md')) {
            out.push(fullPath);
        }
    }
}
// ─── Chunking ─────────────────────────────────────────────────────────────────
/** Split a file into paragraph-level chunks (separated by blank lines). */
function chunkFile(absPath, root) {
    const relPath = path.relative(root, absPath).replace(/\\/g, '/');
    const raw = fs.readFileSync(absPath, 'utf-8');
    const lines = raw.split(/\r?\n/);
    const chunks = [];
    // Detect language from path (Story/EN/... → "EN")
    const langMatch = /[/\\]Story[/\\]([A-Za-z]{2,3})[/\\]/.exec(relPath);
    const language = langMatch ? langMatch[1].toUpperCase() : undefined;
    let blockStart = -1;
    let blockLines = [];
    const flush = (endIdx) => {
        if (blockLines.length === 0) {
            return;
        }
        const text = blockLines.join('\n').trimEnd();
        if (!text.trim()) {
            return;
        }
        const startLine = blockStart + 1; // 1-based
        const endLine = endIdx; // 1-based inclusive
        const id = chunkId(relPath, startLine, endLine, text);
        chunks.push({ id, relPath, absPath, startLine, endLine, text, language });
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '') {
            flush(i); // end of block (i is 1-based end of previous block… i+1 - 1 = i in 0-based)
            blockStart = -1;
            blockLines = [];
        }
        else {
            if (blockStart === -1) {
                blockStart = i;
            }
            blockLines.push(line);
        }
    }
    flush(lines.length);
    return chunks;
}
/** Chunk all discovered files in a workspace. */
function chunkWorkspace(root, opts = {}) {
    const files = discoverFiles(root, opts);
    const chunks = [];
    for (const f of files) {
        try {
            chunks.push(...chunkFile(f, root));
        }
        catch {
            /* skip unreadable files */
        }
    }
    return chunks;
}
// ─── Helpers ─────────────────────────────────────────────────────────────────
function chunkId(relPath, start, end, text) {
    return crypto
        .createHash('sha256')
        .update(`${relPath}:${start}:${end}:${text}`)
        .digest('hex')
        .slice(0, 16);
}
function extractChapterNumber(filename) {
    const m = /(\d+)/.exec(filename);
    return m ? parseInt(m[1], 10) : null;
}
function parseChapterRange(range) {
    if (!range) {
        return [null, null];
    }
    const parts = range.split('-');
    const min = parseInt(parts[0], 10);
    const max = parts.length > 1 ? parseInt(parts[1], 10) : min;
    return [isNaN(min) ? null : min, isNaN(max) ? null : max];
}
function resolvedLangs(language) {
    if (!language || language === 'ALL') {
        return null;
    }
    return [language.toUpperCase()];
}
//# sourceMappingURL=docstore.js.map