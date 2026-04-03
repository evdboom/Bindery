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
    title: 'List Books',
    description: 'List all books registered via --book args in the MCP server config. Call this first to discover available book names.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
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
    title: 'Identify Book',
    description: 'Identify which book matches the directory you are working in. ' +
        'Pass your current working directory (e.g. /home/user/Me/MyNovel) and the server ' +
        'will match it against registered books by folder name or .bindery/settings.json. ' +
        'Use this when you know your workspace path but not the book name.',
    inputSchema: {
        workingDirectory: zod_1.z.string().describe('The absolute path of your current working directory or project root.'),
    },
    annotations: { readOnlyHint: true },
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
    title: 'Health Check',
    description: 'Check server status: active book, settings, index, and embedding backend.',
    inputSchema: { book: bookSchema },
    annotations: { readOnlyHint: true },
}, async ({ book }) => {
    try {
        return ok((0, tools_js_1.toolHealth)((0, registry_js_1.resolveBook)(book).root));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('index_build', {
    title: 'Build Index',
    description: 'Build or rebuild the search index for a book. Run after adding/editing chapters.',
    inputSchema: { book: bookSchema },
    annotations: { destructiveHint: true },
}, async ({ book }) => {
    try {
        return ok((0, tools_js_1.toolIndexBuild)((0, registry_js_1.resolveBook)(book).root));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('index_status', {
    title: 'Index Status',
    description: 'Show current index metadata: chunk count and build time.',
    inputSchema: { book: bookSchema },
    annotations: { readOnlyHint: true },
}, async ({ book }) => {
    try {
        return ok((0, tools_js_1.toolIndexStatus)((0, registry_js_1.resolveBook)(book).root));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('get_text', {
    title: 'Get Text',
    description: 'Read a source file by relative path, optionally restricted to a line range.',
    inputSchema: {
        book: bookSchema,
        identifier: zod_1.z.string().describe('Relative path from workspace root, e.g. Story/EN/Act I/Chapter01.md'),
        startLine: zod_1.z.number().optional().describe('1-based start line (optional)'),
        endLine: zod_1.z.number().optional().describe('1-based end line inclusive (optional)'),
    },
    annotations: { readOnlyHint: true },
}, async ({ book, identifier, startLine, endLine }) => {
    try {
        return ok((0, tools_js_1.toolGetText)((0, registry_js_1.resolveBook)(book).root, { identifier, startLine, endLine }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('get_chapter', {
    title: 'Get Chapter',
    description: 'Fetch the full content of a chapter by number and language.',
    inputSchema: {
        book: bookSchema,
        chapterNumber: zod_1.z.number().describe('Chapter number (1-based)'),
        language: zod_1.z.string().describe('Language code, e.g. EN or NL'),
    },
    annotations: { readOnlyHint: true },
}, async ({ book, chapterNumber, language }) => {
    try {
        return ok((0, tools_js_1.toolGetChapter)((0, registry_js_1.resolveBook)(book).root, { chapterNumber, language }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('get_overview', {
    title: 'Get Overview',
    description: 'List the chapter structure (acts, chapters, titles) for one or all languages.',
    inputSchema: {
        book: bookSchema,
        language: zod_1.z.string().optional().describe('Language code or ALL (default: ALL)'),
        act: zod_1.z.number().optional().describe('Filter to act number 1, 2, or 3 (optional)'),
    },
    annotations: { readOnlyHint: true },
}, async ({ book, language, act }) => {
    try {
        return ok((0, tools_js_1.toolGetOverview)((0, registry_js_1.resolveBook)(book).root, { language, act }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('get_notes', {
    title: 'Get Notes',
    description: 'Read from Notes/ and Details_*.md files, optionally filtered by category name or character/place name.',
    inputSchema: {
        book: bookSchema,
        category: zod_1.z.string().optional().describe('Filter by file/category name substring'),
        name: zod_1.z.string().optional().describe('Filter sections containing this name'),
    },
    annotations: { readOnlyHint: true },
}, async ({ book, category, name }) => {
    try {
        return ok((0, tools_js_1.toolGetNotes)((0, registry_js_1.resolveBook)(book).root, { category, name }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('search', {
    title: 'Search',
    description: 'Full-text BM25 search across all story and notes files. Returns ranked snippets.',
    inputSchema: {
        book: bookSchema,
        query: zod_1.z.string().describe('Search query'),
        language: zod_1.z.string().optional().describe('Language filter: EN, NL, or ALL'),
        maxResults: zod_1.z.number().optional().describe('Max results to return (default 10)'),
    },
    annotations: { readOnlyHint: true },
}, async ({ book, query, language, maxResults }) => {
    try {
        return ok(await (0, tools_js_1.toolSearch)((0, registry_js_1.resolveBook)(book).root, { query, language, maxResults }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('retrieve_context', {
    title: 'Retrieve Context',
    description: 'Retrieve the most relevant passages for a query. Best for "where did X happen" or "what did character Y say about Z".',
    inputSchema: {
        book: bookSchema,
        query: zod_1.z.string().describe('Natural language query'),
        language: zod_1.z.string().optional().describe('Language filter: EN, NL, or ALL'),
        topK: zod_1.z.number().optional().describe('Number of results (default 6)'),
    },
    annotations: { readOnlyHint: true },
}, async ({ book, query, language, topK }) => {
    try {
        return ok(await (0, tools_js_1.toolRetrieveContext)((0, registry_js_1.resolveBook)(book).root, { query, language, topK }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('format', {
    title: 'Format Typography',
    description: 'Apply typography formatting (curly quotes, em-dashes, ellipses) to a file or folder.',
    inputSchema: {
        book: bookSchema,
        filePath: zod_1.z.string().optional().describe('Relative path to file or folder (default: entire book)'),
        dryRun: zod_1.z.boolean().optional().describe('Preview changes without writing (default false)'),
        noRecurse: zod_1.z.boolean().optional().describe('Do not recurse into subdirectories (default false)'),
    },
    annotations: { destructiveHint: true },
}, async ({ book, filePath, dryRun, noRecurse }) => {
    try {
        return ok((0, tools_js_1.toolFormat)((0, registry_js_1.resolveBook)(book).root, { filePath, dryRun, noRecurse }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('get_review_text', {
    title: 'Review Text',
    description: 'Structured git diff of uncommitted changes with context lines. ' +
        'Filter by language folder (EN, NL, or ALL). Ignores CR-at-EOL to avoid CRLF noise. ' +
        'Set autoStage to true to stage reviewed files so the next call only shows new changes.',
    inputSchema: {
        book: bookSchema,
        language: zod_1.z.string().optional().describe('Language filter: EN, NL, or ALL (default ALL)'),
        contextLines: zod_1.z.number().optional().describe('Context lines around each change (default 3)'),
        autoStage: zod_1.z.boolean().optional().describe('Stage reviewed files after producing diff (default false)'),
    },
    annotations: { destructiveHint: true },
}, async ({ book, language, contextLines, autoStage }) => {
    try {
        return ok((0, tools_js_1.toolGetReviewText)((0, registry_js_1.resolveBook)(book).root, { language, contextLines, autoStage }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('git_snapshot', {
    title: 'Git Snapshot',
    description: 'Save a snapshot (git commit) of all changes in story, notes, and arc folders. ' +
        'Provides an optional commit message — defaults to a timestamp. ' +
        'Use this to create save points after writing sessions or successful reviews.',
    inputSchema: {
        book: bookSchema,
        message: zod_1.z.string().optional().describe('Snapshot message (default: timestamp)'),
    },
    annotations: { destructiveHint: true },
}, async ({ book, message }) => {
    try {
        return ok((0, tools_js_1.toolGitSnapshot)((0, registry_js_1.resolveBook)(book).root, { message }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('get_translation', {
    title: 'Get Translation',
    description: 'Look up glossary entries in .bindery/translations.json. ' +
        'Without a word, lists all entries for the language. ' +
        'With a word, does a forgiving case-insensitive lookup including plural and inflected forms. ' +
        'For dialect substitution rules, use get_dialect instead.',
    inputSchema: {
        book: bookSchema,
        language: zod_1.z.string().describe('Language code or label (e.g. "nl", "fr", "Dutch")'),
        word: zod_1.z.string().optional().describe('Word or term to look up (optional — omit to list all)'),
        type: zod_1.z.enum(['glossary', 'substitution']).optional().describe('Entry type filter — defaults to "glossary"'),
    },
    annotations: { readOnlyHint: true },
}, async ({ book, language, word, type }) => {
    try {
        return ok((0, tools_js_1.toolGetTranslation)((0, registry_js_1.resolveBook)(book).root, { language, word, type }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('add_translation', {
    title: 'Add Translation',
    description: 'Add or update a glossary entry in .bindery/translations.json for agent reference. ' +
        'Glossaries are cross-language term pairs (source → target language) used by agents for consistency, ' +
        'not auto-applied during export. For dialect substitution rules (e.g. US→UK spelling), use add_dialect.',
    inputSchema: {
        book: bookSchema,
        targetLangCode: zod_1.z.string().describe('Target language code (e.g. "nl", "fr")'),
        from: zod_1.z.string().describe('Source term (e.g. "FluxCore")'),
        to: zod_1.z.string().describe('Target term (e.g. "FluxKern")'),
    },
    annotations: { destructiveHint: true },
}, async ({ book, targetLangCode, from, to }) => {
    try {
        return ok((0, tools_js_1.toolAddTranslation)((0, registry_js_1.resolveBook)(book).root, { targetLangCode, from, to }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('add_dialect', {
    title: 'Add Dialect Rule',
    description: 'Add or update a dialect substitution rule in .bindery/translations.json. ' +
        'Substitution rules are auto-applied during export (e.g. US→UK spelling: color→colour). ' +
        'For cross-language glossary entries, use add_translation.',
    inputSchema: {
        book: bookSchema,
        dialectCode: zod_1.z.string().describe('Dialect code used as key, e.g. "en-gb"'),
        from: zod_1.z.string().describe('Source word (e.g. "color")'),
        to: zod_1.z.string().describe('Target word (e.g. "colour")'),
    },
    annotations: { destructiveHint: true },
}, async ({ book, dialectCode, from, to }) => {
    try {
        return ok((0, tools_js_1.toolAddDialect)((0, registry_js_1.resolveBook)(book).root, { dialectCode, from, to }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('get_dialect', {
    title: 'Get Dialect Rules',
    description: 'Look up dialect substitution rules in .bindery/translations.json. ' +
        'Without a word, lists all rules for the dialect. ' +
        'With a word, does a forgiving case-insensitive lookup. ' +
        'For cross-language glossary entries, use get_translation.',
    inputSchema: {
        book: bookSchema,
        dialectCode: zod_1.z.string().describe('Dialect code, e.g. "en-gb"'),
        word: zod_1.z.string().optional().describe('Word to look up (optional — omit to list all rules)'),
    },
    annotations: { readOnlyHint: true },
}, async ({ book, dialectCode, word }) => {
    try {
        return ok((0, tools_js_1.toolGetDialect)((0, registry_js_1.resolveBook)(book).root, { dialectCode, word }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('add_language', {
    title: 'Add Language',
    description: 'Add a new language to .bindery/settings.json and optionally scaffold ' +
        'its story folder with stub files mirroring the default language structure.',
    inputSchema: {
        book: bookSchema,
        code: zod_1.z.string().describe('Language code, e.g. "NL", "FR", "DE"'),
        folderName: zod_1.z.string().optional().describe('Story subfolder name (defaults to code)'),
        chapterWord: zod_1.z.string().optional().describe('Word for "Chapter" in this language'),
        actPrefix: zod_1.z.string().optional().describe('Word for "Act" prefix in this language'),
        prologueLabel: zod_1.z.string().optional().describe('Word for "Prologue" in this language'),
        epilogueLabel: zod_1.z.string().optional().describe('Word for "Epilogue" in this language'),
        createStubs: zod_1.z.boolean().optional().describe('Mirror source language folder with stub files (default true)'),
    },
    annotations: { destructiveHint: true },
}, async ({ book, code, folderName, chapterWord, actPrefix, prologueLabel, epilogueLabel, createStubs }) => {
    try {
        return ok((0, tools_js_1.toolAddLanguage)((0, registry_js_1.resolveBook)(book).root, { code, folderName, chapterWord, actPrefix, prologueLabel, epilogueLabel, createStubs }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('init_workspace', {
    title: 'Init Workspace',
    description: 'Create or update .bindery/settings.json and .bindery/translations.json. ' +
        'All arguments are optional — smart defaults are used for any omitted values. ' +
        'Safe to run on an existing workspace: existing settings are preserved unless explicitly overridden. ' +
        'Detects language folders in the story directory automatically.',
    inputSchema: {
        book: bookSchema,
        bookTitle: zod_1.z.string().optional().describe('Book title (defaults to folder name)'),
        author: zod_1.z.string().optional().describe('Author name'),
        storyFolder: zod_1.z.string().optional().describe('Story folder name relative to root (default: Story)'),
        genre: zod_1.z.string().optional().describe('Genre, e.g. sci-fi/fantasy'),
        description: zod_1.z.string().optional().describe('One-line description used in AI instruction files'),
        targetAudience: zod_1.z.string().optional().describe('Target audience, e.g. 12+ or adults'),
    },
    annotations: { destructiveHint: true },
}, async ({ book, bookTitle, author, storyFolder, genre, description, targetAudience }) => {
    try {
        return ok((0, tools_js_1.toolInitWorkspace)((0, registry_js_1.resolveBook)(book).root, { bookTitle, author, storyFolder, genre, description, targetAudience }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('setup_ai_files', {
    title: 'Setup AI Files',
    description: 'Generate AI assistant instruction files (CLAUDE.md, .github/copilot-instructions.md, ' +
        '.cursor/rules, AGENTS.md) and Claude skill templates from .bindery/settings.json. ' +
        'Run init_workspace first. Safe to run multiple times — skips existing files unless overwrite is true.',
    inputSchema: {
        book: bookSchema,
        targets: zod_1.z.array(zod_1.z.string()).optional().describe('Which files to generate: claude, copilot, cursor, agents. Default: all.'),
        skills: zod_1.z.array(zod_1.z.string()).optional().describe('Which Claude skills to generate: review, brainstorm, memory, translate, status, continuity, read_aloud. Default: all.'),
        overwrite: zod_1.z.boolean().optional().describe('Overwrite existing files? Default false (skip existing).'),
    },
    annotations: { destructiveHint: true },
}, async ({ book, targets, skills, overwrite }) => {
    try {
        return ok((0, tools_js_1.toolSetupAiFiles)((0, registry_js_1.resolveBook)(book).root, { targets, skills, overwrite }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('memory_list', {
    title: 'Memory List',
    description: 'List all session memory files in .bindery/memories/. Returns each filename and its line count.',
    inputSchema: { book: bookSchema },
    annotations: { readOnlyHint: true },
}, async ({ book }) => {
    try {
        return ok((0, tools_js_1.toolMemoryList)((0, registry_js_1.resolveBook)(book).root));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('memory_append', {
    title: 'Memory Append',
    description: 'Append a dated session entry to a memory file in .bindery/memories/. ' +
        'Creates the file if it does not exist. ' +
        'The tool stamps the current date; supply a short title and the content to record.',
    inputSchema: {
        book: bookSchema,
        file: zod_1.z.string().describe('Filename within .bindery/memories/, e.g. global.md or ch10.md'),
        title: zod_1.z.string().describe('Short session title describing the topic'),
        content: zod_1.z.string().describe('Text to record under this session entry'),
    },
    annotations: { destructiveHint: true },
}, async ({ book, file, title, content }) => {
    try {
        return ok((0, tools_js_1.toolMemoryAppend)((0, registry_js_1.resolveBook)(book).root, { file, title, content }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('memory_compact', {
    title: 'Memory Compact',
    description: 'Overwrite a memory file with a compacted version supplied by the model. ' +
        'The original is backed up to .bindery/memories/archive/ before overwriting. ' +
        'Use this when a memory file has grown too large and needs to be summarised.',
    inputSchema: {
        book: bookSchema,
        file: zod_1.z.string().describe('Filename within .bindery/memories/, e.g. global.md'),
        compacted_content: zod_1.z.string().describe('Full replacement content (model-supplied summary)'),
    },
    annotations: { destructiveHint: true },
}, async ({ book, file, compacted_content }) => {
    try {
        return ok((0, tools_js_1.toolMemoryCompact)((0, registry_js_1.resolveBook)(book).root, { file, compacted_content }));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('chapter_status_get', {
    title: 'Chapter Status Get',
    description: 'Read the current chapter progress tracker from .bindery/chapter-status.json. ' +
        'Returns a formatted summary grouped by status (done, in-progress, draft, planned, needs-review). ' +
        'Returns a clear empty-state message if no status has been recorded yet.',
    inputSchema: { book: bookSchema },
    annotations: { readOnlyHint: true },
}, async ({ book }) => {
    try {
        return ok((0, tools_js_1.toolChapterStatusGet)((0, registry_js_1.resolveBook)(book).root));
    }
    catch (e) {
        return err(e);
    }
});
server.registerTool('chapter_status_update', {
    title: 'Chapter Status Update',
    description: 'Upsert chapter progress entries in .bindery/chapter-status.json. ' +
        'Send only the chapters that changed — existing entries not in the payload are preserved. ' +
        'Creates the file if it does not exist. ' +
        'Each entry requires: number (int), title (string), language (e.g. EN), status (done | in-progress | draft | planned | needs-review). ' +
        'Optional: wordCount (int), notes (string).',
    inputSchema: {
        book: bookSchema,
        chapters: zod_1.z.array(zod_1.z.object({
            number: zod_1.z.number().int().describe('Chapter number'),
            title: zod_1.z.string().describe('Chapter title'),
            language: zod_1.z.string().describe('Language code, e.g. EN or NL'),
            status: zod_1.z.enum(['done', 'in-progress', 'draft', 'planned', 'needs-review']),
            wordCount: zod_1.z.number().int().optional().describe('Approximate word count'),
            notes: zod_1.z.string().optional().describe('Short agent note about this chapter'),
        })).describe('Chapter entries to upsert (existing entries not listed are preserved)'),
    },
    annotations: { destructiveHint: true },
}, async ({ book, chapters }) => {
    try {
        return ok((0, tools_js_1.toolChapterStatusUpdate)((0, registry_js_1.resolveBook)(book).root, { chapters }));
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