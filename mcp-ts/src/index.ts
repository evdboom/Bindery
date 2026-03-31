#!/usr/bin/env node
/**
 * Bindery MCP Server — stdio entry point.
 *
 * Usage:
 *   bindery-mcp [--root <path>]
 *
 * --root defaults to process.cwd(), so Cowork/Claude Code projects that bind
 * to a directory need no configuration at all.
 */

import { Server }                  from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport }    from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
    toolHealth,
    toolIndexBuild,
    toolIndexStatus,
    toolGetText,
    toolGetChapter,
    toolGetOverview,
    toolGetNotes,
    toolSearch,
    toolRetrieveContext,
    toolFormat,
} from './tools.js';

// ─── Resolve root ─────────────────────────────────────────────────────────────

function resolveRoot(): string {
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
        name:        'health',
        description: 'Check server status: workspace root, settings, index, and embedding backend.',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name:        'index_build',
        description: 'Build or rebuild the search index for this workspace. Run after adding/editing chapters.',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name:        'index_status',
        description: 'Show current index metadata: chunk count and build time.',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name:        'get_text',
        description: 'Read a source file by relative path, optionally restricted to a line range.',
        inputSchema: {
            type: 'object',
            properties: {
                identifier: { type: 'string', description: 'Relative path from workspace root, e.g. Story/EN/Act I/Chapter01.md' },
                startLine:  { type: 'number', description: '1-based start line (optional)' },
                endLine:    { type: 'number', description: '1-based end line inclusive (optional)' },
            },
            required: ['identifier'],
        },
    },
    {
        name:        'get_chapter',
        description: 'Fetch the full content of a chapter by number and language.',
        inputSchema: {
            type: 'object',
            properties: {
                chapterNumber: { type: 'number', description: 'Chapter number (1-based)' },
                language:      { type: 'string', description: 'Language code, e.g. EN or NL' },
            },
            required: ['chapterNumber', 'language'],
        },
    },
    {
        name:        'get_overview',
        description: 'List the chapter structure (acts, chapters, titles) for one or all languages.',
        inputSchema: {
            type: 'object',
            properties: {
                language: { type: 'string', description: 'Language code or ALL (default: ALL)' },
                act:      { type: 'number', description: 'Filter to act number 1, 2, or 3 (optional)' },
            },
            required: [],
        },
    },
    {
        name:        'get_notes',
        description: 'Read from Notes/ and Details_*.md files, optionally filtered by category name or character/place name.',
        inputSchema: {
            type: 'object',
            properties: {
                category: { type: 'string', description: 'Filter by file/category name substring' },
                name:     { type: 'string', description: 'Filter sections containing this name' },
            },
            required: [],
        },
    },
    {
        name:        'search',
        description: 'Full-text BM25 search across all story and notes files. Returns ranked snippets.',
        inputSchema: {
            type: 'object',
            properties: {
                query:       { type: 'string', description: 'Search query' },
                language:    { type: 'string', description: 'Language filter: EN, NL, or ALL' },
                maxResults:  { type: 'number', description: 'Max results to return (default 10)' },
            },
            required: ['query'],
        },
    },
    {
        name:        'retrieve_context',
        description: 'Retrieve the most relevant passages for a query. Best for "where did X happen" or "what did character Y say about Z".',
        inputSchema: {
            type: 'object',
            properties: {
                query:    { type: 'string', description: 'Natural language query' },
                language: { type: 'string', description: 'Language filter: EN, NL, or ALL' },
                topK:     { type: 'number', description: 'Number of results (default 6)' },
            },
            required: ['query'],
        },
    },
    {
        name:        'format',
        description: 'Apply typography formatting (curly quotes, em-dashes, ellipses) to a file or folder.',
        inputSchema: {
            type: 'object',
            properties: {
                filePath:  { type: 'string', description: 'Relative path to file or folder (default: entire workspace)' },
                dryRun:    { type: 'boolean', description: 'Preview changes without writing (default false)' },
                noRecurse: { type: 'boolean', description: 'Do not recurse into subdirectories (default false)' },
            },
            required: [],
        },
    },
] as const;

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new Server(
    { name: 'bindery-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, unknown>;

    try {
        let text: string;

        switch (name) {
            case 'health':
                text = toolHealth(ROOT);
                break;
            case 'index_build':
                text = toolIndexBuild(ROOT);
                break;
            case 'index_status':
                text = toolIndexStatus(ROOT);
                break;
            case 'get_text':
                text = toolGetText(ROOT, {
                    identifier: a['identifier'] as string,
                    startLine:  a['startLine'] as number | undefined,
                    endLine:    a['endLine']   as number | undefined,
                });
                break;
            case 'get_chapter':
                text = toolGetChapter(ROOT, {
                    chapterNumber: a['chapterNumber'] as number,
                    language:      a['language']      as string,
                });
                break;
            case 'get_overview':
                text = toolGetOverview(ROOT, {
                    language: a['language'] as string | undefined,
                    act:      a['act']      as number | undefined,
                });
                break;
            case 'get_notes':
                text = toolGetNotes(ROOT, {
                    category: a['category'] as string | undefined,
                    name:     a['name']     as string | undefined,
                });
                break;
            case 'search':
                text = await toolSearch(ROOT, {
                    query:       a['query']       as string,
                    language:    a['language']    as string | undefined,
                    maxResults:  a['maxResults']  as number | undefined,
                    caseSensitive: a['caseSensitive'] as boolean | undefined,
                });
                break;
            case 'retrieve_context':
                text = await toolRetrieveContext(ROOT, {
                    query:    a['query']    as string,
                    language: a['language'] as string | undefined,
                    topK:     a['topK']     as number | undefined,
                });
                break;
            case 'format':
                text = toolFormat(ROOT, {
                    filePath:  a['filePath']  as string | undefined,
                    dryRun:    a['dryRun']    as boolean | undefined,
                    noRecurse: a['noRecurse'] as boolean | undefined,
                });
                break;
            default:
                return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
        }

        return { content: [{ type: 'text', text }] };
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((err) => {
    process.stderr.write(`Fatal: ${err}\n`);
    process.exit(1);
});
