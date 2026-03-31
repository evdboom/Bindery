"use strict";
/**
 * Bindery book registry.
 *
 * Books are configured via one of two mechanisms (both can be combined):
 *
 * 1. CLI flags (Claude Desktop config, VS Code .vscode/mcp.json):
 *      --book ScaryBook=/Users/me/Projects/ScaryBook
 *      --book MyNovel=/Users/me/Writing/MyNovel
 *
 * 2. BINDERY_BOOKS env var (mcpb desktop extension):
 *      BINDERY_BOOKS="ScaryBook=/Users/me/Projects/ScaryBook;MyNovel=/path"
 *
 * All tool calls require an explicit `book` argument (use list_books to
 * discover available names).
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
exports.resolveBook = resolveBook;
exports.listBooks = listBooks;
exports.findBookByPath = findBookByPath;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
// ─── Startup configuration ────────────────────────────────────────────────────
function parseEntry(raw, into) {
    const eq = raw.indexOf('=');
    if (eq > 0) {
        const name = raw.slice(0, eq).trim();
        const dir = path.resolve(raw.slice(eq + 1).trim());
        if (name) {
            into.set(name, dir);
        }
    }
}
function parseBooksFromArgs() {
    const books = new Map();
    // 1. --book Name=path CLI flags
    const args = process.argv;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--book' && args[i + 1]) {
            parseEntry(args[i + 1], books);
            i++;
        }
    }
    // 2. BINDERY_BOOKS env var (semicolon-separated Name=path pairs)
    const envBooks = process.env['BINDERY_BOOKS'];
    if (envBooks) {
        for (const entry of envBooks.split(';')) {
            if (entry.trim()) {
                parseEntry(entry, books);
            }
        }
    }
    return books;
}
/** Immutable map of name → absolute path, built once at process start. */
const BOOKS = parseBooksFromArgs();
/**
 * Resolve a book name to its absolute path.
 * `name` is always required — callers must specify which book to use.
 */
function resolveBook(name) {
    const root = BOOKS.get(name);
    if (!root) {
        const available = [...BOOKS.keys()];
        throw new Error(available.length
            ? `Unknown book "${name}". Available: ${available.join(', ')}`
            : `No books configured. Add --book Name=/path args in your MCP server config.`);
    }
    return { name, root };
}
/**
 * List all books configured at server startup.
 */
function listBooks() {
    return [...BOOKS.entries()].map(([name, bookPath]) => ({ name, path: bookPath }));
}
/**
 * Identify which registered book matches a directory the agent is running in.
 *
 * Designed for container/mount scenarios (e.g. Cowork) where the agent's
 * filesystem path differs from the configured one:
 *   configured: C:\Users\me\Projects\MyNovel
 *   agent sees: /home/user/MyNovel
 *
 * Match strategy (first wins):
 *   1. Exact path match (non-container, same OS)
 *   2. Basename of agentPath matches basename of a registered book path
 *   3. .bindery/settings.json in agentPath has a "name" matching a book key
 *
 * The agentPath is ONLY used for identification — all file operations still
 * go through resolveBook() which uses the server-configured path.
 */
function findBookByPath(agentPath) {
    const normalized = path.resolve(agentPath);
    // 1. Exact match
    for (const [name, bookPath] of BOOKS) {
        if (normalized === bookPath) {
            return { name, path: bookPath };
        }
    }
    // 2. Basename match
    const agentBase = path.basename(normalized).toLowerCase();
    for (const [name, bookPath] of BOOKS) {
        if (path.basename(bookPath).toLowerCase() === agentBase) {
            return { name, path: bookPath };
        }
    }
    // 3. .bindery/settings.json "name" field
    try {
        const settingsFile = path.join(agentPath, '.bindery', 'settings.json');
        if (fs.existsSync(settingsFile)) {
            const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
            const projName = (settings.name ?? '').toString().trim();
            if (projName && BOOKS.has(projName)) {
                return { name: projName, path: BOOKS.get(projName) };
            }
        }
    }
    catch { /* ignore parse errors */ }
    return null;
}
//# sourceMappingURL=registry.js.map