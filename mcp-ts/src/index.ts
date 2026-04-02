#!/usr/bin/env node
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

import { McpServer }             from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport }  from '@modelcontextprotocol/sdk/server/stdio.js';
import { z }                     from 'zod';

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
    toolGetReviewText,
    toolGitSnapshot,
    toolGetTranslation,
    toolAddTranslation,
    toolInitWorkspace,
    toolSetupAiFiles,
    toolMemoryList,
    toolMemoryAppend,
    toolMemoryCompact,
} from './tools.js';
import { resolveBook, listBooks, findBookByPath } from './registry.js';

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new McpServer(
    { name: 'bindery-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } }
);

// ─── Shared helpers ───────────────────────────────────────────────────────────

const bookSchema = z.string().describe(
    'Book name as configured via --book args (e.g. "MyNovel"). Call list_books to see available names.'
);

function ok(text: string)  { return { content: [{ type: 'text' as const, text }] }; }
function err(e: unknown)   { return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true as const }; }

// ─── Tools ────────────────────────────────────────────────────────────────────

server.registerTool('list_books', {
    title: 'List Books',
    description: 'List all books registered via --book args in the MCP server config. Call this first to discover available book names.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
}, async () => {
    const books = listBooks();
    if (books.length === 0) {
        return ok(
            'No books configured.\n\n' +
            'Add --book args to the MCP server in your claude_desktop_config.json:\n\n' +
            '  "args": ["dist/index.js", "--book", "MyNovel=/path/to/project"]'
        );
    }
    return ok(books.map(b => `${b.name}  →  ${b.path}`).join('\n'));
});

server.registerTool('identify_book', {
    title: 'Identify Book',
    description:
        'Identify which book matches the directory you are working in. ' +
        'Pass your current working directory (e.g. /home/user/Me/MyNovel) and the server ' +
        'will match it against registered books by folder name or .bindery/settings.json. ' +
        'Use this when you know your workspace path but not the book name.',
    inputSchema: {
        workingDirectory: z.string().describe(
            'The absolute path of your current working directory or project root.'
        ),
    },
    annotations: { readOnlyHint: true },
}, async ({ workingDirectory }) => {
    try {
        const match = findBookByPath(workingDirectory);
        if (!match) {
            const books = listBooks();
            return ok(
                `No book matches directory "${workingDirectory}".\n\n` +
                (books.length
                    ? `Available books:\n${books.map(b => `  ${b.name}  →  ${b.path}`).join('\n')}`
                    : 'No books configured.')
            );
        }
        return ok(match.name);
    } catch (e) { return err(e); }
});

server.registerTool('health', {
    title: 'Health Check',
    description: 'Check server status: active book, settings, index, and embedding backend.',
    inputSchema: { book: bookSchema },
    annotations: { readOnlyHint: true },
}, async ({ book }) => {
    try { return ok(toolHealth(resolveBook(book).root)); } catch (e) { return err(e); }
});

server.registerTool('index_build', {
    title: 'Build Index',
    description: 'Build or rebuild the search index for a book. Run after adding/editing chapters.',
    inputSchema: { book: bookSchema },
    annotations: { destructiveHint: true },
}, async ({ book }) => {
    try { return ok(toolIndexBuild(resolveBook(book).root)); } catch (e) { return err(e); }
});

server.registerTool('index_status', {
    title: 'Index Status',
    description: 'Show current index metadata: chunk count and build time.',
    inputSchema: { book: bookSchema },
    annotations: { readOnlyHint: true },
}, async ({ book }) => {
    try { return ok(toolIndexStatus(resolveBook(book).root)); } catch (e) { return err(e); }
});

server.registerTool('get_text', {
    title: 'Get Text',
    description: 'Read a source file by relative path, optionally restricted to a line range.',
    inputSchema: {
        book:      bookSchema,
        identifier: z.string().describe('Relative path from workspace root, e.g. Story/EN/Act I/Chapter01.md'),
        startLine:  z.number().optional().describe('1-based start line (optional)'),
        endLine:    z.number().optional().describe('1-based end line inclusive (optional)'),
    },
    annotations: { readOnlyHint: true },
}, async ({ book, identifier, startLine, endLine }) => {
    try { return ok(toolGetText(resolveBook(book).root, { identifier, startLine, endLine })); } catch (e) { return err(e); }
});

server.registerTool('get_chapter', {
    title: 'Get Chapter',
    description: 'Fetch the full content of a chapter by number and language.',
    inputSchema: {
        book:          bookSchema,
        chapterNumber: z.number().describe('Chapter number (1-based)'),
        language:      z.string().describe('Language code, e.g. EN or NL'),
    },
    annotations: { readOnlyHint: true },
}, async ({ book, chapterNumber, language }) => {
    try { return ok(toolGetChapter(resolveBook(book).root, { chapterNumber, language })); } catch (e) { return err(e); }
});

server.registerTool('get_overview', {
    title: 'Get Overview',
    description: 'List the chapter structure (acts, chapters, titles) for one or all languages.',
    inputSchema: {
        book:     bookSchema,
        language: z.string().optional().describe('Language code or ALL (default: ALL)'),
        act:      z.number().optional().describe('Filter to act number 1, 2, or 3 (optional)'),
    },
    annotations: { readOnlyHint: true },
}, async ({ book, language, act }) => {
    try { return ok(toolGetOverview(resolveBook(book).root, { language, act })); } catch (e) { return err(e); }
});

server.registerTool('get_notes', {
    title: 'Get Notes',
    description: 'Read from Notes/ and Details_*.md files, optionally filtered by category name or character/place name.',
    inputSchema: {
        book:     bookSchema,
        category: z.string().optional().describe('Filter by file/category name substring'),
        name:     z.string().optional().describe('Filter sections containing this name'),
    },
    annotations: { readOnlyHint: true },
}, async ({ book, category, name }) => {
    try { return ok(toolGetNotes(resolveBook(book).root, { category, name })); } catch (e) { return err(e); }
});

server.registerTool('search', {
    title: 'Search',
    description: 'Full-text BM25 search across all story and notes files. Returns ranked snippets.',
    inputSchema: {
        book:       bookSchema,
        query:      z.string().describe('Search query'),
        language:   z.string().optional().describe('Language filter: EN, NL, or ALL'),
        maxResults: z.number().optional().describe('Max results to return (default 10)'),
    },
    annotations: { readOnlyHint: true },
}, async ({ book, query, language, maxResults }) => {
    try { return ok(await toolSearch(resolveBook(book).root, { query, language, maxResults })); } catch (e) { return err(e); }
});

server.registerTool('retrieve_context', {
    title: 'Retrieve Context',
    description: 'Retrieve the most relevant passages for a query. Best for "where did X happen" or "what did character Y say about Z".',
    inputSchema: {
        book:     bookSchema,
        query:    z.string().describe('Natural language query'),
        language: z.string().optional().describe('Language filter: EN, NL, or ALL'),
        topK:     z.number().optional().describe('Number of results (default 6)'),
    },
    annotations: { readOnlyHint: true },
}, async ({ book, query, language, topK }) => {
    try { return ok(await toolRetrieveContext(resolveBook(book).root, { query, language, topK })); } catch (e) { return err(e); }
});

server.registerTool('format', {
    title: 'Format Typography',
    description: 'Apply typography formatting (curly quotes, em-dashes, ellipses) to a file or folder.',
    inputSchema: {
        book:      bookSchema,
        filePath:  z.string().optional().describe('Relative path to file or folder (default: entire book)'),
        dryRun:    z.boolean().optional().describe('Preview changes without writing (default false)'),
        noRecurse: z.boolean().optional().describe('Do not recurse into subdirectories (default false)'),
    },
    annotations: { destructiveHint: true },
}, async ({ book, filePath, dryRun, noRecurse }) => {
    try { return ok(toolFormat(resolveBook(book).root, { filePath, dryRun, noRecurse })); } catch (e) { return err(e); }
});

server.registerTool('get_review_text', {
    title: 'Review Text',
    description:
        'Structured git diff of uncommitted changes with context lines. ' +
        'Filter by language folder (EN, NL, or ALL). Ignores CR-at-EOL to avoid CRLF noise. ' +
        'Set autoStage to true to stage reviewed files so the next call only shows new changes.',
    inputSchema: {
        book:         bookSchema,
        language:     z.string().optional().describe('Language filter: EN, NL, or ALL (default ALL)'),
        contextLines: z.number().optional().describe('Context lines around each change (default 3)'),
        autoStage:    z.boolean().optional().describe('Stage reviewed files after producing diff (default false)'),
    },
    annotations: { destructiveHint: true },
}, async ({ book, language, contextLines, autoStage }) => {
    try { return ok(toolGetReviewText(resolveBook(book).root, { language, contextLines, autoStage })); } catch (e) { return err(e); }
});

server.registerTool('git_snapshot', {
    title: 'Git Snapshot',
    description:
        'Save a snapshot (git commit) of all changes in story, notes, and arc folders. ' +
        'Provides an optional commit message — defaults to a timestamp. ' +
        'Use this to create save points after writing sessions or successful reviews.',
    inputSchema: {
        book:    bookSchema,
        message: z.string().optional().describe('Snapshot message (default: timestamp)'),
    },
    annotations: { destructiveHint: true },
}, async ({ book, message }) => {
    try { return ok(toolGitSnapshot(resolveBook(book).root, { message })); } catch (e) { return err(e); }
});

server.registerTool('get_translation', {
    title: 'Get Translation',
    description:
        'Look up translation/substitution rules in .bindery/translations.json. ' +
        'Without a word, lists all rules for the language. ' +
        'With a word, does a forgiving case-insensitive lookup including plural and inflected forms.',
    inputSchema: {
        book:     bookSchema,
        language: z.string().describe('Language key, label, or code (e.g. "nl", "en-gb", "British English")'),
        word:     z.string().optional().describe('Word or term to look up (optional — omit to list all rules)'),
    },
    annotations: { readOnlyHint: true },
}, async ({ book, language, word }) => {
    try { return ok(toolGetTranslation(resolveBook(book).root, { language, word })); } catch (e) { return err(e); }
});

server.registerTool('add_translation', {
    title: 'Add Translation',
    description:
        'Add or update a substitution rule in .bindery/translations.json. ' +
        'Creates the entry if it does not exist. ' +
        'Rules are used during chapter export to convert dialect-specific words (e.g. US→UK spelling).',
    inputSchema: {
        book:    bookSchema,
        langKey: z.string().describe('Language key in translations.json, e.g. "en-gb" or "nl"'),
        from:    z.string().describe('Source word or phrase (e.g. "airplane")'),
        to:      z.string().describe('Target word or phrase (e.g. "aeroplane")'),
    },
    annotations: { destructiveHint: true },
}, async ({ book, langKey, from, to }) => {
    try { return ok(toolAddTranslation(resolveBook(book).root, { langKey, from, to })); } catch (e) { return err(e); }
});

server.registerTool('init_workspace', {
    title: 'Init Workspace',
    description:
        'Create or update .bindery/settings.json and .bindery/translations.json. ' +
        'All arguments are optional — smart defaults are used for any omitted values. ' +
        'Safe to run on an existing workspace: existing settings are preserved unless explicitly overridden. ' +
        'Detects language folders in the story directory automatically.',
    inputSchema: {
        book:            bookSchema,
        bookTitle:       z.string().optional().describe('Book title (defaults to folder name)'),
        author:          z.string().optional().describe('Author name'),
        storyFolder:     z.string().optional().describe('Story folder name relative to root (default: Story)'),
        genre:           z.string().optional().describe('Genre, e.g. sci-fi/fantasy'),
        description:     z.string().optional().describe('One-line description used in AI instruction files'),
        targetAudience:  z.string().optional().describe('Target audience, e.g. 12+ or adults'),
    },
    annotations: { destructiveHint: true },
}, async ({ book, bookTitle, author, storyFolder, genre, description, targetAudience }) => {
    try { return ok(toolInitWorkspace(resolveBook(book).root, { bookTitle, author, storyFolder, genre, description, targetAudience })); } catch (e) { return err(e); }
});

server.registerTool('setup_ai_files', {
    title: 'Setup AI Files',
    description:
        'Generate AI assistant instruction files (CLAUDE.md, .github/copilot-instructions.md, ' +
        '.cursor/rules, AGENTS.md) and Claude skill templates from .bindery/settings.json. ' +
        'Run init_workspace first. Safe to run multiple times — skips existing files unless overwrite is true.',
    inputSchema: {
        book:      bookSchema,
        targets:   z.array(z.string()).optional().describe('Which files to generate: claude, copilot, cursor, agents. Default: all.'),
        skills:    z.array(z.string()).optional().describe('Which Claude skills to generate: review, brainstorm, memory, translate, status, continuity, read_aloud. Default: all.'),
        overwrite: z.boolean().optional().describe('Overwrite existing files? Default false (skip existing).'),
    },
    annotations: { destructiveHint: true },
}, async ({ book, targets, skills, overwrite }) => {
    try { return ok(toolSetupAiFiles(resolveBook(book).root, { targets, skills, overwrite })); } catch (e) { return err(e); }
});

server.registerTool('memory_list', {
    title: 'Memory List',
    description: 'List all session memory files in .bindery/memories/. Returns each filename and its line count.',
    inputSchema: { book: bookSchema },
    annotations: { readOnlyHint: true },
}, async ({ book }) => {
    try { return ok(toolMemoryList(resolveBook(book).root)); } catch (e) { return err(e); }
});

server.registerTool('memory_append', {
    title: 'Memory Append',
    description:
        'Append a dated session entry to a memory file in .bindery/memories/. ' +
        'Creates the file if it does not exist. ' +
        'The tool stamps the current date; supply a short title and the content to record.',
    inputSchema: {
        book:    bookSchema,
        file:    z.string().describe('Filename within .bindery/memories/, e.g. global.md or ch10.md'),
        title:   z.string().describe('Short session title describing the topic'),
        content: z.string().describe('Text to record under this session entry'),
    },
    annotations: { destructiveHint: true },
}, async ({ book, file, title, content }) => {
    try { return ok(toolMemoryAppend(resolveBook(book).root, { file, title, content })); } catch (e) { return err(e); }
});

server.registerTool('memory_compact', {
    title: 'Memory Compact',
    description:
        'Overwrite a memory file with a compacted version supplied by the model. ' +
        'The original is backed up to .bindery/memories/archive/ before overwriting. ' +
        'Use this when a memory file has grown too large and needs to be summarised.',
    inputSchema: {
        book:              bookSchema,
        file:              z.string().describe('Filename within .bindery/memories/, e.g. global.md'),
        compacted_content: z.string().describe('Full replacement content (model-supplied summary)'),
    },
    annotations: { destructiveHint: true },
}, async ({ book, file, compacted_content }) => {
    try { return ok(toolMemoryCompact(resolveBook(book).root, { file, compacted_content })); } catch (e) { return err(e); }
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
