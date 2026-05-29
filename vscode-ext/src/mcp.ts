/**
 * Bindery MCP integration for VS Code.
 *
 * Two surfaces:
 *  1. vscode.lm.registerTool — makes tools available to GitHub Copilot Chat
 *     (must also be declared in package.json `languageModelTools`).
 *  2. writeMcpJson — writes .vscode/mcp.json so Claude for VS Code / Codex
 *     can discover the bundled Node.js MCP server.
 */

import * as vscode from 'vscode';
import * as fs     from 'node:fs';
import * as path   from 'node:path';

// ─── Types mirrored from mcp-ts ───────────────────────────────────────────────

interface GetTextInput    { identifier: string; startLine?: number; endLine?: number }
interface GetChapterInput { chapterNumber: number; language: string }
interface GetBookUntilInput { chapterNumber: number; language: string; startChapter?: number }
interface GetOverviewInput { language?: string; act?: number }
interface GetNotesInput   { category?: string; name?: string }
interface NoteListInput   { category?: string }
interface NoteGetInput    { path: string }
interface NoteCreateInput { path: string; title?: string; content?: string; overwrite?: boolean }
interface NoteAppendInput { path: string; content: string; heading?: string }
interface CharacterListInput { name?: string }
interface CharacterGetInput { name: string }
interface CharacterWriteInput {
    name: string;
    role?: string;
    age?: string;
    origin?: string;
    skills?: string;
    strengths?: string;
    weaknesses?: string;
    personality?: string;
    background?: string;
    narrativeArc?: string;
    appearanceNotes?: string;
    relationships?: string;
    firstAppearance?: string;
    openQuestions?: string;
    continuityNotes?: string;
    indexNotes?: string;
    overwrite?: boolean;
}
interface ArcListInput { kind?: string }
interface ArcGetInput { path: string }
interface ArcWriteInput {
    path: string;
    title?: string;
    kind?: string;
    purpose?: string;
    majorBeats?: string;
    characterMovement?: string;
    worldImplications?: string;
    unresolvedQuestions?: string;
    continuityRisks?: string;
    linkedChapters?: string;
    overwrite?: boolean;
}
interface SearchInput     { query: string; language?: string; maxResults?: number; mode?: 'lexical' | 'semantic_rerank' | 'full_semantic' }
interface FormatInput     { filePath?: string; dryRun?: boolean; noRecurse?: boolean }
interface GetReviewTextInput { language?: string; contextLines?: number; autoStage?: boolean }
interface UpdateWorkspaceInput { remote?: string; branch?: string; switchBranch?: boolean; autoStash?: boolean }
interface GitSnapshotInput   { message?: string; push?: boolean; remote?: string; branch?: string; rememberPushDefaults?: boolean }
interface AddTranslationInput { from: string; to: string; targetLangCode: string }
interface GetTranslationInput { language: string; word?: string; type?: 'glossary' | 'substitution' }
interface AddDialectInput     { dialectCode: string; from: string; to: string }
interface GetDialectInput     { dialectCode: string; word?: string }
interface AddLanguageInput    { code: string; folderName?: string; chapterWord?: string; actPrefix?: string; prologueLabel?: string; epilogueLabel?: string; createStubs?: boolean }
interface InitWorkspaceInput  { bookTitle?: string; author?: string; storyFolder?: string; genre?: string; description?: string; targetAudience?: string }
interface SettingsUpdateInput { patch: Record<string, unknown> }
interface SetupAiFilesInput   { targets?: string[]; skills?: string[]; overwrite?: boolean }
interface MemoryAppendInput   { file: string; title: string; content: string }
interface MemoryCompactInput  { file: string; compacted_content: string }
interface ChapterStatusUpdateInput { chapters: Array<{ number: number; title: string; language: string; status: 'done' | 'in-progress' | 'draft' | 'planned' | 'needs-review'; wordCount?: number; notes?: string }> }
interface SessionFocusGetInput    { section?: string }
interface SessionFocusUpdateInput { currentFocus?: string; nextActions?: string; openQuestions?: string; handoffNotes?: string; mode?: 'replace' | 'append' }
interface InboxResolveInput       { items: number[] }

interface McpTools {
    toolHealth:           (_root: string) => string;
    toolIndexBuild:       (_root: string) => Promise<string>;
    toolIndexStatus:      (_root: string) => string;
    toolGetText:          (_root: string, _args: GetTextInput) => string;
    toolGetChapter:       (_root: string, _args: GetChapterInput) => string;
    toolGetBookUntil:     (_root: string, _args: GetBookUntilInput) => string;
    toolGetOverview:      (_root: string, _args: GetOverviewInput) => string;
    toolGetNotes:         (_root: string, _args: GetNotesInput) => string;
    toolNoteList:         (_root: string, _args: NoteListInput) => string;
    toolNoteGet:          (_root: string, _args: NoteGetInput) => string;
    toolNoteCreate:       (_root: string, _args: NoteCreateInput) => string;
    toolNoteAppend:       (_root: string, _args: NoteAppendInput) => string;
    toolCharacterList:    (_root: string, _args: CharacterListInput) => string;
    toolCharacterGet:     (_root: string, _args: CharacterGetInput) => string;
    toolCharacterCreate:  (_root: string, _args: CharacterWriteInput) => string;
    toolCharacterUpdate:  (_root: string, _args: CharacterWriteInput) => string;
    toolArcList:          (_root: string, _args: ArcListInput) => string;
    toolArcGet:           (_root: string, _args: ArcGetInput) => string;
    toolArcCreate:        (_root: string, _args: ArcWriteInput) => string;
    toolArcUpdate:        (_root: string, _args: ArcWriteInput) => string;
    toolSearch:           (_root: string, _args: SearchInput) => Promise<string>;
    toolFormat:           (_root: string, _args: FormatInput) => string;
    toolGetReviewText:    (_root: string, _args: GetReviewTextInput) => string;
    toolUpdateWorkspace:  (_root: string, _args: UpdateWorkspaceInput) => string;
    toolGitSnapshot:      (_root: string, _args: GitSnapshotInput) => string;
    toolAddTranslation:   (_root: string, _args: AddTranslationInput) => string;
    toolGetTranslation:   (_root: string, _args: GetTranslationInput) => string;
    toolAddDialect:       (_root: string, _args: AddDialectInput) => string;
    toolGetDialect:       (_root: string, _args: GetDialectInput) => string;
    toolAddLanguage:      (_root: string, _args: AddLanguageInput) => string;
    toolInitWorkspace:    (_root: string, _args: InitWorkspaceInput) => string;
    toolSettingsUpdate:   (_root: string, _args: SettingsUpdateInput) => string;
    toolSetupAiFiles:     (_root: string, _args: SetupAiFilesInput) => string;
    toolMemoryList:       (_root: string) => string;
    toolMemoryAppend:     (_root: string, _args: MemoryAppendInput) => string;
    toolMemoryCompact:    (_root: string, _args: MemoryCompactInput) => string;
    toolChapterStatusGet:    (_root: string) => string;
    toolChapterStatusUpdate: (_root: string, _args: ChapterStatusUpdateInput) => string;
    toolSessionFocusGet:     (_root: string, _args: SessionFocusGetInput) => string;
    toolSessionFocusUpdate:  (_root: string, _args: SessionFocusUpdateInput) => string;
    toolInboxProcess:        (_root: string) => string;
    toolInboxResolve:        (_root: string, _args: InboxResolveInput) => string;
}

/**
 * Lazily load the compiled mcp-ts tools at runtime from the extension's
 * bundled output directory. This avoids a cross-project TypeScript import.
 *
 * In production (VSIX), mcp-ts is bundled inside the extension at mcp-ts/out/.
 * In development (F5), mcp-ts is a sibling of vscode-ext/, so we fall back one
 * level up when the bundled copy isn't present.
 */
function loadMcpTools(extensionPath: string): McpTools {
    const bundledPath = path.join(extensionPath, 'mcp-ts', 'out', 'tools');
    const devPath     = path.join(extensionPath, '..', 'mcp-ts', 'out', 'tools');
    const modulePath  = fs.existsSync(bundledPath + '.js') ? bundledPath : devPath;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic path needed for bundled/dev module loading
    return require(modulePath) as McpTools;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function ok(text: string): vscode.LanguageModelToolResult {
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

// ─── Tool registrations ───────────────────────────────────────────────────────

export function registerLmTools(context: vscode.ExtensionContext): void {

    const requireRoot = (): string => {
        const r = getWorkspaceRoot();
        if (!r) { throw new Error('No workspace folder open.'); }
        return r;
    };

    const t = loadMcpTools(context.extensionPath);

    context.subscriptions.push(
        vscode.lm.registerTool('bindery_health', {
            invoke: (_opts, _token) => ok(t.toolHealth(requireRoot())),
        }),

        vscode.lm.registerTool('bindery_index_build', {
            invoke: async (_opts, _token) => ok(await t.toolIndexBuild(requireRoot())),
        }),

        vscode.lm.registerTool('bindery_index_status', {
            invoke: (_opts, _token) => ok(t.toolIndexStatus(requireRoot())),
        }),

        vscode.lm.registerTool<GetTextInput>('bindery_get_text', {
            invoke: (opts, _token) => ok(t.toolGetText(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<GetChapterInput>('bindery_get_chapter', {
            invoke: (opts, _token) => ok(t.toolGetChapter(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<GetBookUntilInput>('bindery_get_book_until', {
            invoke: (opts, _token) => ok(t.toolGetBookUntil(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<GetOverviewInput>('bindery_get_overview', {
            invoke: (opts, _token) => ok(t.toolGetOverview(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<GetNotesInput>('bindery_get_notes', {
            invoke: (opts, _token) => ok(t.toolGetNotes(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<NoteListInput>('bindery_note_list', {
            invoke: (opts, _token) => ok(t.toolNoteList(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<NoteGetInput>('bindery_note_get', {
            invoke: (opts, _token) => ok(t.toolNoteGet(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<NoteCreateInput>('bindery_note_create', {
            invoke: (opts, _token) => ok(t.toolNoteCreate(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<NoteAppendInput>('bindery_note_append', {
            invoke: (opts, _token) => ok(t.toolNoteAppend(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<CharacterListInput>('bindery_character_list', {
            invoke: (opts, _token) => ok(t.toolCharacterList(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<CharacterGetInput>('bindery_character_get', {
            invoke: (opts, _token) => ok(t.toolCharacterGet(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<CharacterWriteInput>('bindery_character_create', {
            invoke: (opts, _token) => ok(t.toolCharacterCreate(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<CharacterWriteInput>('bindery_character_update', {
            invoke: (opts, _token) => ok(t.toolCharacterUpdate(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<ArcListInput>('bindery_arc_list', {
            invoke: (opts, _token) => ok(t.toolArcList(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<ArcGetInput>('bindery_arc_get', {
            invoke: (opts, _token) => ok(t.toolArcGet(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<ArcWriteInput>('bindery_arc_create', {
            invoke: (opts, _token) => ok(t.toolArcCreate(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<ArcWriteInput>('bindery_arc_update', {
            invoke: (opts, _token) => ok(t.toolArcUpdate(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<SearchInput>('bindery_search', {
            invoke: async (opts, _token) => ok(await t.toolSearch(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<FormatInput>('bindery_format', {
            invoke: (opts, _token) => ok(t.toolFormat(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<GetReviewTextInput>('bindery_get_review_text', {
            invoke: (opts, _token) => ok(t.toolGetReviewText(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<UpdateWorkspaceInput>('bindery_update_workspace', {
            invoke: (opts, _token) => ok(t.toolUpdateWorkspace(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<GitSnapshotInput>('bindery_git_snapshot', {
            invoke: (opts, _token) => ok(t.toolGitSnapshot(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<AddTranslationInput>('bindery_add_translation', {
            invoke: (opts, _token) => ok(t.toolAddTranslation(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<GetTranslationInput>('bindery_get_translation', {
            invoke: (opts, _token) => ok(t.toolGetTranslation(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<AddDialectInput>('bindery_add_dialect', {
            invoke: (opts, _token) => ok(t.toolAddDialect(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<GetDialectInput>('bindery_get_dialect', {
            invoke: (opts, _token) => ok(t.toolGetDialect(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<AddLanguageInput>('bindery_add_language', {
            invoke: (opts, _token) => ok(t.toolAddLanguage(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<InitWorkspaceInput>('bindery_init_workspace', {
            invoke: (opts, _token) => ok(t.toolInitWorkspace(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<SettingsUpdateInput>('bindery_settings_update', {
            invoke: (opts, _token) => ok(t.toolSettingsUpdate(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<SetupAiFilesInput>('bindery_setup_ai_files', {
            invoke: (opts, _token) => ok(t.toolSetupAiFiles(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool('bindery_memory_list', {
            invoke: (_opts, _token) => ok(t.toolMemoryList(requireRoot())),
        }),

        vscode.lm.registerTool<MemoryAppendInput>('bindery_memory_append', {
            invoke: (opts, _token) => ok(t.toolMemoryAppend(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<MemoryCompactInput>('bindery_memory_compact', {
            invoke: (opts, _token) => ok(t.toolMemoryCompact(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool('bindery_chapter_status_get', {
            invoke: (_opts, _token) => ok(t.toolChapterStatusGet(requireRoot())),
        }),

        vscode.lm.registerTool<ChapterStatusUpdateInput>('bindery_chapter_status_update', {
            invoke: (opts, _token) => ok(t.toolChapterStatusUpdate(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<SessionFocusGetInput>('bindery_session_focus_get', {
            invoke: (opts, _token) => ok(t.toolSessionFocusGet(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<SessionFocusUpdateInput>('bindery_session_focus_update', {
            invoke: (opts, _token) => ok(t.toolSessionFocusUpdate(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool('bindery_inbox_process', {
            invoke: (_opts, _token) => ok(t.toolInboxProcess(requireRoot())),
        }),

        vscode.lm.registerTool<InboxResolveInput>('bindery_inbox_resolve', {
            invoke: (opts, _token) => ok(t.toolInboxResolve(requireRoot(), opts.input)),
        }),
    );
}

// ─── .vscode/mcp.json writer ─────────────────────────────────────────────────

/**
 * Write (or update) .vscode/mcp.json with a bindery-mcp server entry.
 * The server is the bundled Node.js package; no npm install required —
 * VS Code resolves the extension path at runtime.
 *
 * Passes --book with the workspace folder name and path so the MCP server
 * knows which book it's serving.
 *
 * Called by `bindery.registerMcp` command and optionally from the init wizard.
 */
export function writeMcpJson(
    context:  vscode.ExtensionContext,
    root:     string,
): void {
    const mcpJsonPath = path.join(root, '.vscode', 'mcp.json');

    // Server entry: node <extension>/mcp-ts/out/index.js --book Name=path
    const bookName = path.basename(root);
    const serverEntry = {
        command: 'node',
        args:    [
            path.join(context.extensionPath, 'mcp-ts', 'out', 'index.js'),
            '--book', `${bookName}=${root}`,
        ],
        env:     {} as Record<string, string>,
    };

    // Optional Ollama URL from VS Code settings
    const ollamaUrl = vscode.workspace.getConfiguration('bindery').get<string>('ollamaUrl');
    if (ollamaUrl) { serverEntry.env['BINDERY_OLLAMA_URL'] = ollamaUrl; }

    // Read existing mcp.json if present
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(mcpJsonPath)) {
        try { existing = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8')); }
        catch { /* treat as empty */ }
    }

    const servers = (existing['servers'] ?? {}) as Record<string, unknown>;
    servers['bindery'] = serverEntry;
    existing['servers'] = servers;

    fs.mkdirSync(path.dirname(mcpJsonPath), { recursive: true });
    fs.writeFileSync(mcpJsonPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
}

// ─── Command: Register MCP ────────────────────────────────────────────────────

export async function registerMcpCommand(context: vscode.ExtensionContext): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { vscode.window.showErrorMessage('No workspace folder open.'); return; }

    writeMcpJson(context, root);

    const action = await vscode.window.showInformationMessage(
        'Bindery MCP server registered in .vscode/mcp.json. Claude and Codex extensions will pick it up automatically.',
        'Open mcp.json'
    );
    if (action === 'Open mcp.json') {
        const mcpPath = path.join(root, '.vscode', 'mcp.json');
        vscode.window.showTextDocument(await vscode.workspace.openTextDocument(mcpPath));
    }
}


