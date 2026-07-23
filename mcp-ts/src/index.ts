#!/usr/bin/env node
/**
 * Bindery MCP Server — stdio entry point.
 *
 * Book selection is configured at startup via one of:
 *   --book Name=path   CLI flags (claude_desktop_config.json, .vscode/mcp.json)
 *   BINDERY_BOOKS       env var with semicolon-separated Name=path pairs (mcpb)
 *
 * Every tool requires an explicit `book` argument. Use bindery_list_books to discover
 * available names. Agents never receive or provide raw filesystem paths.
 */

import { McpServer }             from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport }  from '@modelcontextprotocol/sdk/server/stdio.js';
import { z }                     from 'zod';

import {
    toolHealth,
    toolDownloadLatestMcp,
    toolIndexBuild,
    toolIndexStatus,
    toolGetText,
    toolGetChapter,
    toolGetBookUntil,
    toolGetOverview,
    toolGetNotes,
    toolNoteList,
    toolNoteGet,
    toolNoteCreate,
    toolNoteAppend,
    toolCharacterList,
    toolCharacterGet,
    toolCharacterCreate,
    toolCharacterUpdate,
    toolArcList,
    toolArcGet,
    toolArcCreate,
    toolArcUpdate,
    toolSearch,
    toolFormat,
    toolGetReviewText,
    toolUpdateWorkspace,
    toolGitSnapshot,
    toolGetTranslation,
    toolAddTranslation,
    toolAddDialect,
    toolGetDialect,
    toolAddLanguage,
    toolInitWorkspace,
    toolSettingsUpdate,
    toolSetupAiFiles,
    toolMemoryList,
    toolMemoryAppend,
    toolMemoryCompact,
    toolSessionFocusGet,
    toolSessionFocusUpdate,
    toolInboxProcess,
    toolInboxResolve,
} from './tools.js';
import { resolveBook, listBooks, findBookByPath } from './registry.js';

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new McpServer(
    { name: 'bindery-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
);

// ─── Shared helpers ───────────────────────────────────────────────────────────

const bookSchema = z.string().describe(
    'Book name as configured via --book args (e.g. "MyNovel"). Call bindery_list_books to see available names.'
);

const characterFields = {
    role: z.string().optional().describe('Narrative role or function in the cast.'),
    age: z.string().optional().describe('Age or age range.'),
    origin: z.string().optional().describe('Origin, home, faction, or background source.'),
    skills: z.string().optional().describe('Skills, powers, expertise, or capabilities.'),
    strengths: z.string().optional().describe('Strengths or advantages.'),
    weaknesses: z.string().optional().describe('Weaknesses, flaws, limits, or vulnerabilities.'),
    personality: z.string().optional().describe('Personality notes.'),
    background: z.string().optional().describe('Backstory and context.'),
    narrativeArc: z.string().optional().describe('Character movement across the story.'),
    appearanceNotes: z.string().optional().describe('Appearance, voice, gesture, and identifying details.'),
    relationships: z.string().optional().describe('Relationships and dynamics with other characters.'),
    firstAppearance: z.string().optional().describe('First chapter, scene, or note where this character appears.'),
    openQuestions: z.string().optional().describe('Unresolved author questions about the character.'),
    continuityNotes: z.string().optional().describe('Continuity constraints or established facts.'),
    indexNotes: z.string().optional().describe('Short note for the character index row.'),
};

const arcFields = {
    title: z.string().optional().describe('Arc file H1 title. Defaults to a title derived from the filename.'),
    kind: z.string().optional().describe('Arc kind, e.g. overall, act, chapter, thread, or custom.'),
    purpose: z.string().optional().describe('Purpose of this arc in the story structure.'),
    majorBeats: z.string().optional().describe('Major beats for this arc.'),
    characterMovement: z.string().optional().describe('Character movement caused by or tracked in this arc.'),
    worldImplications: z.string().optional().describe('Setting, world, magic, technology, or culture implications.'),
    unresolvedQuestions: z.string().optional().describe('Open plot or structure questions.'),
    continuityRisks: z.string().optional().describe('Continuity risks to watch while drafting or revising.'),
    linkedChapters: z.string().optional().describe('Linked chapter numbers, titles, or ranges.'),
};

function ok(text: string)  { return { content: [{ type: 'text' as const, text }] }; }
function err(e: unknown)   { return { content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true as const }; }

// ─── Tools ────────────────────────────────────────────────────────────────────

server.registerTool('bindery_list_books', {
    title: 'List Books',
    description: 'List all books registered via --book args in the MCP server config. Call this first to discover available book names.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
}, () => {
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

server.registerTool('bindery_identify_book', {
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
}, ({ workingDirectory }) => {
    try {
        const match = findBookByPath(workingDirectory);
        if (!match) {
            const books = listBooks();
            return ok(
                `No book matches directory "${workingDirectory}".\n\n` +
                (books.length
                    ? 'Available books:\n' + books.map(b => '  ' + b.name + '  →  ' + b.path).join('\n')
                    : 'No books configured.')
            );
        }
        return ok(match.name);
    } catch (e) { return err(e); }
});

server.registerTool('bindery_health', {
    title: 'Health Check',
    description: 'Check server status: active book, settings, index, embedding backend, and latest Bindery release availability.',
    inputSchema: { book: bookSchema },
    annotations: { readOnlyHint: true, openWorldHint: true },
}, async ({ book }) => {
    try { return ok(await toolHealth(resolveBook(book).root)); } catch (e) { return err(e); }
});

server.registerTool('bindery_download_latest_mcp', {
    title: 'Download Latest Standalone MCP',
    description:
        'Download and unpack the latest standalone bindery-mcp-server-*.zip release into BINDERY_MCP_LOCATION. ' +
        'This tool does not edit MCP client settings. Not for Claude Desktop/Cowork; use the .mcpb installer there.',
    inputSchema: {
        book: bookSchema,
        client: z.enum(['standalone', 'chatgpt', 'lmstudio', 'other', 'claude']).optional().describe(
            'Optional target client label. If set to claude, the tool refuses and returns .mcpb guidance.'
        ),
    },
    annotations: { destructiveHint: true, openWorldHint: true },
}, async ({ book, client }) => {
    try { return ok(await toolDownloadLatestMcp(resolveBook(book).root, { client })); } catch (e) { return err(e); }
});

server.registerTool('bindery_index_build', {
    title: 'Build Index',
    description: 'Build or rebuild the lexical search index and, when enabled, the semantic embedding index for a book. Run after meaningful content changes.',
    inputSchema: { book: bookSchema },
    annotations: { destructiveHint: true, openWorldHint: true },
}, async ({ book }) => {
    try { return ok(await toolIndexBuild(resolveBook(book).root)); } catch (e) { return err(e); }
});

server.registerTool('bindery_index_status', {
    title: 'Index Status',
    description: 'Show current index metadata: chunk count and build time.',
    inputSchema: { book: bookSchema },
    annotations: { readOnlyHint: true },
}, ({ book }) => {
    try { return ok(toolIndexStatus(resolveBook(book).root)); } catch (e) { return err(e); }
});

server.registerTool('bindery_get_text', {
    title: 'Get Text',
    description: 'Read a source file by relative path, optionally restricted to a line range.',
    inputSchema: {
        book:      bookSchema,
        identifier: z.string().describe('Relative path from workspace root, e.g. Story/EN/Act I/Chapter01.md'),
        startLine:  z.number().optional().describe('1-based start line (optional)'),
        endLine:    z.number().optional().describe('1-based end line inclusive (optional)'),
    },
    annotations: { readOnlyHint: true },
}, ({ book, identifier, startLine, endLine }) => {
    try { return ok(toolGetText(resolveBook(book).root, { identifier, startLine, endLine })); } catch (e) { return err(e); }
});

server.registerTool('bindery_get_chapter', {
    title: 'Get Chapter',
    description: 'Fetch the full content of a chapter by number and language.',
    inputSchema: {
        book:          bookSchema,
        chapterNumber: z.number().describe('Chapter number (1-based)'),
        language:      z.string().describe('Language code, e.g. EN or NL'),
    },
    annotations: { readOnlyHint: true },
}, ({ book, chapterNumber, language }) => {
    try { return ok(toolGetChapter(resolveBook(book).root, { chapterNumber, language })); } catch (e) { return err(e); }
});

server.registerTool('bindery_get_book_until', {
    title: 'Get Book Until',
    description: 'Fetch chapters from a starting chapter through a target chapter (inclusive), concatenated in reading order.',
    inputSchema: {
        book:          bookSchema,
        chapterNumber: z.number().describe('Final chapter number (inclusive, 1-based)'),
        language:      z.string().describe('Language code, e.g. EN or NL'),
        startChapter:  z.number().optional().describe('Starting chapter number (default 1)'),
    },
    annotations: { readOnlyHint: true },
}, ({ book, chapterNumber, language, startChapter }) => {
    try { return ok(toolGetBookUntil(resolveBook(book).root, { chapterNumber, language, startChapter })); } catch (e) { return err(e); }
});

server.registerTool('bindery_get_overview', {
    title: 'Get Overview',
    description: 'List the chapter structure (acts, chapters, titles) for one or all languages.',
    inputSchema: {
        book:     bookSchema,
        language: z.string().optional().describe('Language code or ALL (default: ALL)'),
        act:      z.number().optional().describe('Filter to act number 1, 2, or 3 (optional)'),
    },
    annotations: { readOnlyHint: true },
}, ({ book, language, act }) => {
    try { return ok(toolGetOverview(resolveBook(book).root, { language, act })); } catch (e) { return err(e); }
});

server.registerTool('bindery_get_notes', {
    title: 'Get Notes',
    description: 'Read from Notes/ files, optionally filtered by category name or character/place name.',
    inputSchema: {
        book:     bookSchema,
        category: z.string().optional().describe('Filter by file/category name substring'),
        name:     z.string().optional().describe('Filter sections containing this name'),
    },
    annotations: { readOnlyHint: true },
}, ({ book, category, name }) => {
    try { return ok(toolGetNotes(resolveBook(book).root, { category, name })); } catch (e) { return err(e); }
});

server.registerTool('bindery_note_list', {
    title: 'Note List',
    description: 'List markdown note files under the configured notes folder, optionally filtered to a category folder.',
    inputSchema: {
        book:     bookSchema,
        category: z.string().optional().describe('Optional category/folder under Notes, e.g. Characters, World, Scenes, Research'),
    },
    annotations: { readOnlyHint: true },
}, ({ book, category }) => {
    try { return ok(toolNoteList(resolveBook(book).root, { category })); } catch (e) { return err(e); }
});

server.registerTool('bindery_note_get', {
    title: 'Note Get',
    description: 'Read a single markdown note by path relative to the configured notes folder.',
    inputSchema: {
        book: bookSchema,
        path: z.string().describe('Note path relative to the notes folder, e.g. Inbox.md or Characters/index.md'),
    },
    annotations: { readOnlyHint: true },
}, ({ book, path }) => {
    try { return ok(toolNoteGet(resolveBook(book).root, { path })); } catch (e) { return err(e); }
});

server.registerTool('bindery_note_create', {
    title: 'Note Create',
    description: 'Create a markdown note under the configured notes folder. Refuses to overwrite unless overwrite is true.',
    inputSchema: {
        book:      bookSchema,
        path:      z.string().describe('Note path relative to the notes folder, e.g. World/Rules.md'),
        title:     z.string().optional().describe('Optional H1 title. Defaults to a title derived from the filename.'),
        content:   z.string().optional().describe('Optional markdown body to write below the H1 title.'),
        overwrite: z.boolean().optional().describe('Replace an existing note if true. Default false.'),
    },
    annotations: { destructiveHint: true },
}, ({ book, path, title, content, overwrite }) => {
    try { return ok(toolNoteCreate(resolveBook(book).root, { path, title, content, overwrite })); } catch (e) { return err(e); }
});

server.registerTool('bindery_note_append', {
    title: 'Note Append',
    description: 'Append markdown content to a note under the configured notes folder, creating the file if needed.',
    inputSchema: {
        book:    bookSchema,
        path:    z.string().describe('Note path relative to the notes folder, e.g. Inbox.md or World/Rules.md'),
        content: z.string().describe('Markdown content to append.'),
        heading: z.string().optional().describe('Optional H2 heading to insert before the appended content.'),
    },
    annotations: { destructiveHint: true },
}, ({ book, path, content, heading }) => {
    try { return ok(toolNoteAppend(resolveBook(book).root, { path, content, heading })); } catch (e) { return err(e); }
});

server.registerTool('bindery_character_list', {
    title: 'Character List',
    description: 'List structured character profile files under the configured characters folder.',
    inputSchema: {
        book: bookSchema,
        name: z.string().optional().describe('Optional character-name filter.'),
    },
    annotations: { readOnlyHint: true },
}, ({ book, name }) => {
    try { return ok(toolCharacterList(resolveBook(book).root, { name })); } catch (e) { return err(e); }
});

server.registerTool('bindery_character_get', {
    title: 'Character Get',
    description: 'Read a structured character profile by character name.',
    inputSchema: {
        book: bookSchema,
        name: z.string().describe('Character name. The tool resolves the matching slugged profile file.'),
    },
    annotations: { readOnlyHint: true },
}, ({ book, name }) => {
    try { return ok(toolCharacterGet(resolveBook(book).root, { name })); } catch (e) { return err(e); }
});

server.registerTool('bindery_character_create', {
    title: 'Character Create',
    description: 'Create a structured character profile and update Notes/Characters/index.md.',
    inputSchema: {
        book: bookSchema,
        name: z.string().describe('Character name. Used for the profile H1 and slugged filename.'),
        ...characterFields,
        overwrite: z.boolean().optional().describe('Replace an existing profile if true. Default false.'),
    },
    annotations: { destructiveHint: true },
}, ({ book, ...args }) => {
    try { return ok(toolCharacterCreate(resolveBook(book).root, args)); } catch (e) { return err(e); }
});

server.registerTool('bindery_character_update', {
    title: 'Character Update',
    description: 'Update known fields in a structured character profile and refresh the character index row.',
    inputSchema: {
        book: bookSchema,
        name: z.string().describe('Character name. The tool resolves the matching slugged profile file.'),
        ...characterFields,
    },
    annotations: { destructiveHint: true },
}, ({ book, ...args }) => {
    try { return ok(toolCharacterUpdate(resolveBook(book).root, args)); } catch (e) { return err(e); }
});

server.registerTool('bindery_arc_list', {
    title: 'Arc List',
    description: 'List structured arc files under the configured arc folder.',
    inputSchema: {
        book: bookSchema,
        kind: z.string().optional().describe('Optional kind filter, e.g. overall, act, chapter, thread, custom.'),
    },
    annotations: { readOnlyHint: true },
}, ({ book, kind }) => {
    try { return ok(toolArcList(resolveBook(book).root, { kind })); } catch (e) { return err(e); }
});

server.registerTool('bindery_arc_get', {
    title: 'Arc Get',
    description: 'Read a structured arc file by path relative to the configured arc folder.',
    inputSchema: {
        book: bookSchema,
        path: z.string().describe('Arc path relative to the arc folder, e.g. Overall.md or Acts/act-i.md.'),
    },
    annotations: { readOnlyHint: true },
}, ({ book, path }) => {
    try { return ok(toolArcGet(resolveBook(book).root, { path })); } catch (e) { return err(e); }
});

server.registerTool('bindery_arc_create', {
    title: 'Arc Create',
    description: 'Create a structured arc file under the configured arc folder and update Arc/index.md.',
    inputSchema: {
        book: bookSchema,
        path: z.string().describe('Arc path relative to the arc folder, e.g. Acts/act-i.md.'),
        ...arcFields,
        overwrite: z.boolean().optional().describe('Replace an existing arc file if true. Default false.'),
    },
    annotations: { destructiveHint: true },
}, ({ book, ...args }) => {
    try { return ok(toolArcCreate(resolveBook(book).root, args)); } catch (e) { return err(e); }
});

server.registerTool('bindery_arc_update', {
    title: 'Arc Update',
    description: 'Update known fields in a structured arc file and refresh Arc/index.md.',
    inputSchema: {
        book: bookSchema,
        path: z.string().describe('Arc path relative to the arc folder, e.g. Acts/act-i.md.'),
        ...arcFields,
    },
    annotations: { destructiveHint: true },
}, ({ book, ...args }) => {
    try { return ok(toolArcUpdate(resolveBook(book).root, args)); } catch (e) { return err(e); }
});

server.registerTool('bindery_search', {
    title: 'Search',
    description: 'Search the book corpus using lexical BM25, semantic reranking, or full semantic search. If Ollama or a semantic index is unavailable, semantic modes fall back to lexical results with a warning.',
    inputSchema: {
        book:       bookSchema,
        query:      z.string().describe('Search query'),
        language:   z.string().optional().describe('Language filter: EN, NL, or ALL'),
        maxResults: z.number().optional().describe('Max results to return (default 10)'),
        mode:       z.enum(['lexical', 'semantic_rerank', 'full_semantic']).optional().describe('Search mode override. Defaults to the configured MCP search mode.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
}, async ({ book, query, language, maxResults, mode }) => {
    try { return ok(await toolSearch(resolveBook(book).root, { query, language, maxResults, mode })); } catch (e) { return err(e); }
});

server.registerTool('bindery_format', {
    title: 'Format Typography',
    description: 'Apply typography formatting (curly quotes, em-dashes, ellipses) to a file or folder.',
    inputSchema: {
        book:      bookSchema,
        filePath:  z.string().optional().describe('Relative path to file or folder (default: entire book)'),
        dryRun:    z.boolean().optional().describe('Preview changes without writing (default false)'),
        noRecurse: z.boolean().optional().describe('Do not recurse into subdirectories (default false)'),
    },
    annotations: { destructiveHint: true },
}, ({ book, filePath, dryRun, noRecurse }) => {
    try { return ok(toolFormat(resolveBook(book).root, { filePath, dryRun, noRecurse })); } catch (e) { return err(e); }
});

server.registerTool('bindery_get_review_text', {
    title: 'Review Text',
    description:
        'Structured review payload combining (a) the git diff of uncommitted changes and (b) any regions wrapped in Bindery review markers ' +
        '(<!-- Bindery: Review start --> ... <!-- Bindery: Review stop -->). ' +
        'Marker regions are included even when the surrounding lines have already been committed — useful when an author commits work-in-progress and continues on another machine. ' +
        'A missing stop marker means the region runs to end of file. Filter by language folder (EN, NL, or ALL). Ignores CR-at-EOL to avoid CRLF noise. ' +
        'Set autoStage to true to stage reviewed files AND remove the review-marker lines from disk (staged together) so the next call only shows new changes.',
    inputSchema: {
        book:         bookSchema,
        language:     z.string().optional().describe('Language filter: EN, NL, or ALL (default ALL)'),
        contextLines: z.number().optional().describe('Context lines around each change (default 3)'),
        autoStage:    z.boolean().optional().describe('Stage reviewed files and consume review markers after producing the diff (default false)'),
    },
    annotations: { destructiveHint: true },
}, ({ book, language, contextLines, autoStage }) => {
    try { return ok(toolGetReviewText(resolveBook(book).root, { language, contextLines, autoStage })); } catch (e) { return err(e); }
});

server.registerTool('bindery_update_workspace', {
    title: 'Update Workspace',
    description:
        'Fetch and pull the current git branch for this workspace, report the current branch versus the remote default branch, ' +
        'and optionally switch to a specified branch before pulling. If local changes would block the update, the tool can auto-stash them first.',
    inputSchema: {
        book:         bookSchema,
        remote:       z.string().optional().describe('Preferred remote name to fetch from and pull against (default: origin or first remote)'),
        branch:       z.string().optional().describe('Optional branch name to switch to before pulling'),
        switchBranch: z.boolean().optional().describe('Allow the tool to switch to the requested branch before pulling (default false)'),
        autoStash:    z.boolean().optional().describe('Temporarily stash local changes before pull when needed (default true)'),
    },
    annotations: { destructiveHint: true, openWorldHint: true },
}, ({ book, remote, branch, switchBranch, autoStash }) => {
    try { return ok(toolUpdateWorkspace(resolveBook(book).root, { remote, branch, switchBranch, autoStash })); } catch (e) { return err(e); }
});

server.registerTool('bindery_git_snapshot', {
    title: 'Git Snapshot',
    description:
        'Save a snapshot (git commit) of all changes in the bindery workspace. ' +
        'Provides an optional commit message, can optionally push to a remote branch, and can remember push defaults in settings.json. ' +
        'Use this to create save points after writing sessions or successful reviews.',
    inputSchema: {
        book:                 bookSchema,
        message:              z.string().optional().describe('Snapshot message (default: timestamp)'),
        push:                 z.boolean().optional().describe('Push the new commit after saving the snapshot (default: use stored setting or false)'),
        remote:               z.string().optional().describe('Remote name to push to (default: stored setting, origin, or first remote)'),
        branch:               z.string().optional().describe('Branch to push (default: stored setting or current branch)'),
        rememberPushDefaults: z.boolean().optional().describe('Persist the push preference, remote, and branch under .bindery/settings.json'),
    },
    annotations: { destructiveHint: true, openWorldHint: true },
}, ({ book, message, push, remote, branch, rememberPushDefaults }) => {
    try { return ok(toolGitSnapshot(resolveBook(book).root, { message, push, remote, branch, rememberPushDefaults })); } catch (e) { return err(e); }
});

server.registerTool('bindery_get_translation', {
    title: 'Get Translation',
    description:
        'Look up glossary entries in .bindery/translations.json. ' +
        'Without a word, lists all entries for the language. ' +
        'With a word, does a forgiving case-insensitive lookup including plural and inflected forms. ' +
        'For dialect substitution rules, use bindery_get_dialect instead.',
    inputSchema: {
        book:     bookSchema,
        language: z.string().describe('Language code or label (e.g. "nl", "fr", "Dutch")'),
        word:     z.string().optional().describe('Word or term to look up (optional — omit to list all)'),
        type:     z.enum(['glossary', 'substitution']).optional().describe('Entry type filter — defaults to "glossary"'),
    },
    annotations: { readOnlyHint: true },
}, ({ book, language, word, type }) => {
    try { return ok(toolGetTranslation(resolveBook(book).root, { language, word, type })); } catch (e) { return err(e); }
});

server.registerTool('bindery_add_translation', {
    title: 'Add Translation',
    description:
        'Add or update a glossary entry in .bindery/translations.json for agent reference. ' +
        'Glossaries are cross-language term pairs (source → target language) used by agents for consistency, ' +
        'not auto-applied during export. For dialect substitution rules (e.g. US→UK spelling), use bindery_add_dialect.',
    inputSchema: {
        book:           bookSchema,
        targetLangCode: z.string().describe('Target language code (e.g. "nl", "fr")'),
        from:           z.string().describe('Source term (e.g. "Core")'),
        to:             z.string().describe('Target term (e.g. "Kern")'),
    },
    annotations: { destructiveHint: true },
}, ({ book, targetLangCode, from, to }) => {
    try { return ok(toolAddTranslation(resolveBook(book).root, { targetLangCode, from, to })); } catch (e) { return err(e); }
});

server.registerTool('bindery_add_dialect', {
    title: 'Add Dialect Rule',
    description:
        'Add or update a dialect substitution rule in .bindery/translations.json. ' +
        'Substitution rules are auto-applied during export (e.g. US→UK spelling: color→colour). ' +
        'For cross-language glossary entries, use bindery_add_translation.',
    inputSchema: {
        book:        bookSchema,
        dialectCode: z.string().describe('Dialect code used as key, e.g. "en-gb"'),
        from:        z.string().describe('Source word (e.g. "color")'),
        to:          z.string().describe('Target word (e.g. "colour")'),
    },
    annotations: { destructiveHint: true },
}, ({ book, dialectCode, from, to }) => {
    try { return ok(toolAddDialect(resolveBook(book).root, { dialectCode, from, to })); } catch (e) { return err(e); }
});

server.registerTool('bindery_get_dialect', {
    title: 'Get Dialect Rules',
    description:
        'Look up dialect substitution rules in .bindery/translations.json. ' +
        'Without a word, lists all rules for the dialect. ' +
        'With a word, does a forgiving case-insensitive lookup. ' +
        'For cross-language glossary entries, use bindery_get_translation.',
    inputSchema: {
        book:        bookSchema,
        dialectCode: z.string().describe('Dialect code, e.g. "en-gb"'),
        word:        z.string().optional().describe('Word to look up (optional — omit to list all rules)'),
    },
    annotations: { readOnlyHint: true },
}, ({ book, dialectCode, word }) => {
    try { return ok(toolGetDialect(resolveBook(book).root, { dialectCode, word })); } catch (e) { return err(e); }
});

server.registerTool('bindery_add_language', {
    title: 'Add Language',
    description:
        'Add a new language to .bindery/settings.json and optionally scaffold ' +
        'its story folder with stub files mirroring the default language structure.',
    inputSchema: {
        book:          bookSchema,
        code:          z.string().describe('Language code, e.g. "NL", "FR", "DE"'),
        folderName:    z.string().optional().describe('Story subfolder name (defaults to code)'),
        chapterWord:   z.string().optional().describe('Word for "Chapter" in this language'),
        actPrefix:     z.string().optional().describe('Word for "Act" prefix in this language'),
        prologueLabel: z.string().optional().describe('Word for "Prologue" in this language'),
        epilogueLabel: z.string().optional().describe('Word for "Epilogue" in this language'),
        createStubs:   z.boolean().optional().describe('Mirror source language folder with stub files (default true)'),
    },
    annotations: { destructiveHint: true },
}, ({ book, code, folderName, chapterWord, actPrefix, prologueLabel, epilogueLabel, createStubs }) => {
    try { return ok(toolAddLanguage(resolveBook(book).root, { code, folderName, chapterWord, actPrefix, prologueLabel, epilogueLabel, createStubs })); } catch (e) { return err(e); }
});

server.registerTool('bindery_init_workspace', {
    title: 'Init Workspace',
    description:
        'Create or update .bindery/settings.json, .bindery/translations.json, .bindery/README.md, ' +
        'and the opinionated Arc, Notes, Characters, SESSION, PREFERENCES, and memory scaffold. ' +
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
}, ({ book, bookTitle, author, storyFolder, genre, description, targetAudience }) => {
    try { return ok(toolInitWorkspace(resolveBook(book).root, { bookTitle, author, storyFolder, genre, description, targetAudience })); } catch (e) { return err(e); }
});

server.registerTool('bindery_settings_update', {
    title: 'Settings Update',
    description:
        'Merge a partial patch into .bindery/settings.json without replacing unrelated keys. ' +
        'Useful for persisting tool-specific state (for example proof_read settings).',
    inputSchema: {
        book:  bookSchema,
        patch: z.record(z.string(), z.any()).describe('Partial settings object to deep-merge into .bindery/settings.json'),
    },
    annotations: { destructiveHint: true },
}, ({ book, patch }) => {
    try { return ok(toolSettingsUpdate(resolveBook(book).root, { patch })); } catch (e) { return err(e); }
});

server.registerTool('bindery_setup_ai_files', {
    title: 'Setup AI Files',
    description:
        'Generate AI assistant instruction files (CLAUDE.md, .github/copilot-instructions.md, ' +
        '.cursor/rules, AGENTS.md), Claude skill templates, and the generated .bindery/README.md capability reference from .bindery/settings.json. ' +
        'Run bindery_init_workspace first. Safe to run multiple times — skips existing files unless overwrite is true.',
    inputSchema: {
        book:      bookSchema,
        targets:   z.array(z.string()).optional().describe('Which files to generate: claude, copilot, cursor, agents. Default: all.'),
        skills:    z.array(z.string()).optional().describe('Which Claude skills to generate: review, brainstorm, memory, translate, translation-review, status, continuity, read-aloud, read-in, proof-read, plan-beats, character-setup. Default: all.'),
        overwrite: z.boolean().optional().describe('Overwrite existing files? Default false (skip existing).'),
    },
    annotations: { destructiveHint: true },
}, ({ book, targets, skills, overwrite }) => {
    try { return ok(toolSetupAiFiles(resolveBook(book).root, { targets, skills, overwrite })); } catch (e) { return err(e); }
});

server.registerTool('bindery_memory_list', {
    title: 'Memory List',
    description: 'List all session memory files in .bindery/memories/. Returns each filename and its line count.',
    inputSchema: { book: bookSchema },
    annotations: { readOnlyHint: true },
}, ({ book }) => {
    try { return ok(toolMemoryList(resolveBook(book).root)); } catch (e) { return err(e); }
});

server.registerTool('bindery_memory_append', {
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
}, ({ book, file, title, content }) => {
    try { return ok(toolMemoryAppend(resolveBook(book).root, { file, title, content })); } catch (e) { return err(e); }
});

server.registerTool('bindery_memory_compact', {
    title: 'Memory Compact',
    description:
        'Overwrite a memory file with a compacted version supplied by the model. ' +
        'The original is backed up to .bindery/memories/archive/ before overwriting. ' +
        'Use this when a memory file has grown too large and needs to be summarized.',
    inputSchema: {
        book:              bookSchema,
        file:              z.string().describe('Filename within .bindery/memories/, e.g. global.md'),
        compacted_content: z.string().describe('Full replacement content (model-supplied summary)'),
    },
    annotations: { destructiveHint: true },
}, ({ book, file, compacted_content }) => {
    try { return ok(toolMemoryCompact(resolveBook(book).root, { file, compacted_content })); } catch (e) { return err(e); }
});

server.registerTool('bindery_session_focus_get', {
    title: 'Session Focus Get',
    description:
        'Read the ephemeral session file (default SESSION.md) holding current working state. ' +
        'Optionally pass a section name (Current Focus, Next Actions, Open Questions, Handoff Notes) to read just that section. ' +
        'Durable preferences live in PREFERENCES.md and durable decisions in .bindery/memories/ — this tool does not touch those. ' +
        'Returns a clear empty-state message if the session file does not exist yet.',
    inputSchema: {
        book: bookSchema,
        section: z.string().optional().describe('Optional section name to read, e.g. "Current Focus" or "Handoff Notes"'),
    },
    annotations: { readOnlyHint: true },
}, ({ book, section }) => {
    try { return ok(toolSessionFocusGet(resolveBook(book).root, { section })); } catch (e) { return err(e); }
});

server.registerTool('bindery_session_focus_update', {
    title: 'Session Focus Update',
    description:
        'Update neutral sections of the ephemeral session file (default SESSION.md): Current Focus, Next Actions, Open Questions, Handoff Notes. ' +
        'Only the sections you pass are changed; all other content (and the user-owned PREFERENCES.md) is preserved. ' +
        'mode "replace" (default) overwrites a section body; mode "append" adds beneath existing content (natural for handoff notes). ' +
        'Creates the session file from the standard scaffold if it does not exist. ' +
        'Use this for current working state, not durable preferences (PREFERENCES.md) or durable decisions (bindery_memory_append).',
    inputSchema: {
        book: bookSchema,
        currentFocus:  z.string().optional().describe('New content for the Current Focus section'),
        nextActions:   z.string().optional().describe('New content for the Next Actions section'),
        openQuestions: z.string().optional().describe('New content for the Open Questions section'),
        handoffNotes:  z.string().optional().describe('New content for the Handoff Notes section'),
        mode:          z.enum(['replace', 'append']).optional().describe('replace (default) or append section body'),
    },
    annotations: { destructiveHint: true },
}, ({ book, currentFocus, nextActions, openQuestions, handoffNotes, mode }) => {
    try {
        return ok(toolSessionFocusUpdate(resolveBook(book).root, {
            currentFocus, nextActions, openQuestions, handoffNotes, mode,
        }));
    } catch (e) { return err(e); }
});

server.registerTool('bindery_inbox_process', {
    title: 'Inbox Process',
    description:
        'Read the notes Inbox (Notes/Inbox.md) and return a structured triage proposal: each loose item enumerated with a stable number, ' +
        'plus the destination tools to route them (note_*, character_*, arc_*, memory_*, session_focus_*). ' +
        'This tool only reads and proposes — it never moves, deletes, or categorizes anything. ' +
        'After the user confirms and items are routed with the destination tools, call bindery_inbox_resolve with the item numbers to clear them.',
    inputSchema: { book: bookSchema },
    annotations: { readOnlyHint: true },
}, ({ book }) => {
    try { return ok(toolInboxProcess(resolveBook(book).root)); } catch (e) { return err(e); }
});

server.registerTool('bindery_inbox_resolve', {
    title: 'Inbox Resolve',
    description:
        'Remove already-routed items from the notes Inbox (Notes/Inbox.md) by their item numbers, as enumerated by bindery_inbox_process. ' +
        'Use only after the items have been routed to their destinations and the user has confirmed. ' +
        'Item numbers are stable between bindery_inbox_process and bindery_inbox_resolve. Other items and the inbox heading/intro are preserved.',
    inputSchema: {
        book: bookSchema,
        items: z.array(z.number().int()).describe('Item numbers to remove, as shown by bindery_inbox_process (1-based)'),
    },
    annotations: { destructiveHint: true },
}, ({ book, items }) => {
    try { return ok(toolInboxResolve(resolveBook(book).root, { items })); } catch (e) { return err(e); }
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
