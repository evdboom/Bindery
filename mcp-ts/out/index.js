#!/usr/bin/env node
"use strict";
/**
 * Bindery MCP Server — stdio entry point.
 *
 * Book selection is configured at startup via one of:
 *   --book Name=path   CLI flags (claude_desktop_config.json, .vscode/mcp.json)
 *   BINDERY_BOOKS       env var with semicolon-separated Name=path pairs (mcpb)
 *
 * Every tool requires an explicit `book` argument. Use list_books to discover
 * available names. Agents never receive or provide raw filesystem paths.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const zod_1 = require("zod");
const tools_js_1 = require("./tools.js");
const registry_js_1 = require("./registry.js");
// ─── Server ───────────────────────────────────────────────────────────────────
const server = new mcp_js_1.McpServer({ name: 'bindery-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });
// ─── Shared helpers ───────────────────────────────────────────────────────────
const bookSchema = zod_1.z.string().describe('Book name as configured via --book args (e.g. "MyNovel"). Call list_books to see available names.');
function ok(text) { return { content: [{ type: 'text', text }] }; }
function err(e) { return { content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true }; }
// ─── Tools ────────────────────────────────────────────────────────────────────
server.registerTool('list_books', {
    description: 'List all books registered via --book args in the MCP server config. Call this first to discover available book names.',
    inputSchema: {},
}, async () => {
    const books = (0, registry_js_1.listBooks)();
    if (books.length === 0) {
        return ok('No books configured.\n\n' +
            'Add --book args to the MCP server in your claude_desktop_config.json:\n\n' +
            '  "args": ["dist/index.js", "--book", "MyNovel=/path/to/project"]');
    }
    return ok(books.map(b => `${b.name}  →  ${b.path}`).join('\n'));
});
server.registerTool('identify_book', {
    description: 'Identify which book matches the directory you are working in. ' +
        'Pass your current working directory (e.g. /home/user/Me/MyNovel) and the server ' +
        'will match it against registered books by folder name or .bindery/settings.json. ' +
        'Use this when you know your workspace path but not the book name.',
    inputSchema: {
        workingDirectory: zod_1.z.string().describe('The absolute path of your current working directory or project root.'),
    },
}, async ({ workingDirectory }) => {
    try {
        const match = (0, registry_js_1.findBookByPath)(workingDirectory);
        if (!match) {
            const books = (0, registry_js_1.listBooks)();
            return ok(`No book matches directory "${workingDirectory}".\n\n` +
                (books.length
                    ? `Available books:\n${books.map(b => `  ${b.name}  →  ${b.path}`).join('\n')}`
                    : 'No books configured.'));
        }
        return ok(match.name);
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('health', {
    description: 'Check server status: active book, settings, index, and embedding backend.',
    inputSchema: { book: bookSchema },
}, async ({ book }) => {
    try {
        return ok((0, tools_js_1.toolHealth)((0, registry_js_1.resolveBook)(book).root));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('index_build', {
    description: 'Build or rebuild the search index for a book. Run after adding/editing chapters.',
    inputSchema: { book: bookSchema },
}, async ({ book }) => {
    try {
        return ok((0, tools_js_1.toolIndexBuild)((0, registry_js_1.resolveBook)(book).root));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('index_status', {
    description: 'Show current index metadata: chunk count and build time.',
    inputSchema: { book: bookSchema },
}, async ({ book }) => {
    try {
        return ok((0, tools_js_1.toolIndexStatus)((0, registry_js_1.resolveBook)(book).root));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('get_text', {
    description: 'Read a source file by relative path, optionally restricted to a line range.',
    inputSchema: {
        book: bookSchema,
        identifier: zod_1.z.string().describe('Relative path from workspace root, e.g. Story/EN/Act I/Chapter01.md'),
        startLine: zod_1.z.number().optional().describe('1-based start line (optional)'),
        endLine: zod_1.z.number().optional().describe('1-based end line inclusive (optional)'),
    },
}, async ({ book, identifier, startLine, endLine }) => {
    try {
        return ok((0, tools_js_1.toolGetText)((0, registry_js_1.resolveBook)(book).root, { identifier, startLine, endLine }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('get_chapter', {
    description: 'Fetch the full content of a chapter by number and language.',
    inputSchema: {
        book: bookSchema,
        chapterNumber: zod_1.z.number().describe('Chapter number (1-based)'),
        language: zod_1.z.string().describe('Language code, e.g. EN or NL'),
    },
}, async ({ book, chapterNumber, language }) => {
    try {
        return ok((0, tools_js_1.toolGetChapter)((0, registry_js_1.resolveBook)(book).root, { chapterNumber, language }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('get_overview', {
    description: 'List the chapter structure (acts, chapters, titles) for one or all languages.',
    inputSchema: {
        book: bookSchema,
        language: zod_1.z.string().optional().describe('Language code or ALL (default: ALL)'),
        act: zod_1.z.number().optional().describe('Filter to act number 1, 2, or 3 (optional)'),
    },
}, async ({ book, language, act }) => {
    try {
        return ok((0, tools_js_1.toolGetOverview)((0, registry_js_1.resolveBook)(book).root, { language, act }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('get_notes', {
    description: 'Read from Notes/ and Details_*.md files, optionally filtered by category name or character/place name.',
    inputSchema: {
        book: bookSchema,
        category: zod_1.z.string().optional().describe('Filter by file/category name substring'),
        name: zod_1.z.string().optional().describe('Filter sections containing this name'),
    },
}, async ({ book, category, name }) => {
    try {
        return ok((0, tools_js_1.toolGetNotes)((0, registry_js_1.resolveBook)(book).root, { category, name }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('search', {
    description: 'Full-text BM25 search across all story and notes files. Returns ranked snippets.',
    inputSchema: {
        book: bookSchema,
        query: zod_1.z.string().describe('Search query'),
        language: zod_1.z.string().optional().describe('Language filter: EN, NL, or ALL'),
        maxResults: zod_1.z.number().optional().describe('Max results to return (default 10)'),
    },
}, async ({ book, query, language, maxResults }) => {
    try {
        return ok(await (0, tools_js_1.toolSearch)((0, registry_js_1.resolveBook)(book).root, { query, language, maxResults }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('retrieve_context', {
    description: 'Retrieve the most relevant passages for a query. Best for "where did X happen" or "what did character Y say about Z".',
    inputSchema: {
        book: bookSchema,
        query: zod_1.z.string().describe('Natural language query'),
        language: zod_1.z.string().optional().describe('Language filter: EN, NL, or ALL'),
        topK: zod_1.z.number().optional().describe('Number of results (default 6)'),
    },
}, async ({ book, query, language, topK }) => {
    try {
        return ok(await (0, tools_js_1.toolRetrieveContext)((0, registry_js_1.resolveBook)(book).root, { query, language, topK }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('format', {
    description: 'Apply typography formatting (curly quotes, em-dashes, ellipses) to a file or folder.',
    inputSchema: {
        book: bookSchema,
        filePath: zod_1.z.string().optional().describe('Relative path to file or folder (default: entire book)'),
        dryRun: zod_1.z.boolean().optional().describe('Preview changes without writing (default false)'),
        noRecurse: zod_1.z.boolean().optional().describe('Do not recurse into subdirectories (default false)'),
    },
}, async ({ book, filePath, dryRun, noRecurse }) => {
    try {
        return ok((0, tools_js_1.toolFormat)((0, registry_js_1.resolveBook)(book).root, { filePath, dryRun, noRecurse }));
    }
    catch (e) {
        return err(e);
    }
});
// ─── Start ────────────────────────────────────────────────────────────────────
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    process.stderr.write(`Fatal: ${err}\n`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map