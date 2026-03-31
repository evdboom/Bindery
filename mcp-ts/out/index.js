#!/usr/bin/env node
"use strict";
/**
 * Bindery MCP Server — stdio entry point.
 *
 * Usage:
 *   bindery-mcp [--root <path>]
 *
 * --root defaults to process.cwd(), so Cowork/Claude Code projects that bind
 * to a directory need no configuration at all.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const tools_js_1 = require("./tools.js");
// ─── Resolve root ─────────────────────────────────────────────────────────────
function resolveRoot() {
    const rootFlag = process.argv.indexOf('--root');
    if (rootFlag !== -1 && process.argv[rootFlag + 1]) {
        return process.argv[rootFlag + 1];
    }
    return process.env['BINDERY_SOURCE_ROOT'] ?? process.cwd();
}
const ROOT = resolveRoot();
// ─── Tool definitions ─────────────────────────────────────────────────────────
const TOOLS = [
    {
        name: 'health',
        description: 'Check server status: workspace root, settings, index, and embedding backend.',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'index_build',
        description: 'Build or rebuild the search index for this workspace. Run after adding/editing chapters.',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'index_status',
        description: 'Show current index metadata: chunk count and build time.',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'get_text',
        description: 'Read a source file by relative path, optionally restricted to a line range.',
        inputSchema: {
            type: 'object',
            properties: {
                identifier: { type: 'string', description: 'Relative path from workspace root, e.g. Story/EN/Act I/Chapter01.md' },
                startLine: { type: 'number', description: '1-based start line (optional)' },
                endLine: { type: 'number', description: '1-based end line inclusive (optional)' },
            },
            required: ['identifier'],
        },
    },
    {
        name: 'get_chapter',
        description: 'Fetch the full content of a chapter by number and language.',
        inputSchema: {
            type: 'object',
            properties: {
                chapterNumber: { type: 'number', description: 'Chapter number (1-based)' },
                language: { type: 'string', description: 'Language code, e.g. EN or NL' },
            },
            required: ['chapterNumber', 'language'],
        },
    },
    {
        name: 'get_overview',
        description: 'List the chapter structure (acts, chapters, titles) for one or all languages.',
        inputSchema: {
            type: 'object',
            properties: {
                language: { type: 'string', description: 'Language code or ALL (default: ALL)' },
                act: { type: 'number', description: 'Filter to act number 1, 2, or 3 (optional)' },
            },
            required: [],
        },
    },
    {
        name: 'get_notes',
        description: 'Read from Notes/ and Details_*.md files, optionally filtered by category name or character/place name.',
        inputSchema: {
            type: 'object',
            properties: {
                category: { type: 'string', description: 'Filter by file/category name substring' },
                name: { type: 'string', description: 'Filter sections containing this name' },
            },
            required: [],
        },
    },
    {
        name: 'search',
        description: 'Full-text BM25 search across all story and notes files. Returns ranked snippets.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query' },
                language: { type: 'string', description: 'Language filter: EN, NL, or ALL' },
                maxResults: { type: 'number', description: 'Max results to return (default 10)' },
            },
            required: ['query'],
        },
    },
    {
        name: 'retrieve_context',
        description: 'Retrieve the most relevant passages for a query. Best for "where did X happen" or "what did character Y say about Z".',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Natural language query' },
                language: { type: 'string', description: 'Language filter: EN, NL, or ALL' },
                topK: { type: 'number', description: 'Number of results (default 6)' },
            },
            required: ['query'],
        },
    },
    {
        name: 'format',
        description: 'Apply typography formatting (curly quotes, em-dashes, ellipses) to a file or folder.',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Relative path to file or folder (default: entire workspace)' },
                dryRun: { type: 'boolean', description: 'Preview changes without writing (default false)' },
                noRecurse: { type: 'boolean', description: 'Do not recurse into subdirectories (default false)' },
            },
            required: [],
        },
    },
];
// ─── Server ───────────────────────────────────────────────────────────────────
const server = new index_js_1.Server({ name: 'bindery-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
    tools: TOOLS,
}));
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {});
    try {
        let text;
        switch (name) {
            case 'health':
                text = (0, tools_js_1.toolHealth)(ROOT);
                break;
            case 'index_build':
                text = (0, tools_js_1.toolIndexBuild)(ROOT);
                break;
            case 'index_status':
                text = (0, tools_js_1.toolIndexStatus)(ROOT);
                break;
            case 'get_text':
                text = (0, tools_js_1.toolGetText)(ROOT, {
                    identifier: a['identifier'],
                    startLine: a['startLine'],
                    endLine: a['endLine'],
                });
                break;
            case 'get_chapter':
                text = (0, tools_js_1.toolGetChapter)(ROOT, {
                    chapterNumber: a['chapterNumber'],
                    language: a['language'],
                });
                break;
            case 'get_overview':
                text = (0, tools_js_1.toolGetOverview)(ROOT, {
                    language: a['language'],
                    act: a['act'],
                });
                break;
            case 'get_notes':
                text = (0, tools_js_1.toolGetNotes)(ROOT, {
                    category: a['category'],
                    name: a['name'],
                });
                break;
            case 'search':
                text = await (0, tools_js_1.toolSearch)(ROOT, {
                    query: a['query'],
                    language: a['language'],
                    maxResults: a['maxResults'],
                    caseSensitive: a['caseSensitive'],
                });
                break;
            case 'retrieve_context':
                text = await (0, tools_js_1.toolRetrieveContext)(ROOT, {
                    query: a['query'],
                    language: a['language'],
                    topK: a['topK'],
                });
                break;
            case 'format':
                text = (0, tools_js_1.toolFormat)(ROOT, {
                    filePath: a['filePath'],
                    dryRun: a['dryRun'],
                    noRecurse: a['noRecurse'],
                });
                break;
            default:
                return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
        }
        return { content: [{ type: 'text', text }] };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
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