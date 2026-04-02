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
import * as fs     from 'fs';
import * as path   from 'path';

// ─── Types mirrored from mcp-ts ───────────────────────────────────────────────

interface GetTextInput    { identifier: string; startLine?: number; endLine?: number }
interface GetChapterInput { chapterNumber: number; language: string }
interface GetOverviewInput { language?: string; act?: number }
interface GetNotesInput   { category?: string; name?: string }
interface SearchInput     { query: string; language?: string; maxResults?: number }
interface RetrieveInput   { query: string; language?: string; topK?: number }
interface FormatInput     { filePath?: string; dryRun?: boolean; noRecurse?: boolean }
interface GetReviewTextInput { language?: string; contextLines?: number; autoStage?: boolean }
interface GitSnapshotInput   { message?: string }
interface AddTranslationInput { langKey: string; from: string; to: string }
interface GetTranslationInput { language: string; word?: string }
interface InitWorkspaceInput  { bookTitle?: string; author?: string; storyFolder?: string; genre?: string; description?: string; targetAudience?: string }
interface SetupAiFilesInput   { targets?: string[]; skills?: string[]; overwrite?: boolean }
interface MemoryAppendInput   { file: string; title: string; content: string }
interface MemoryCompactInput  { file: string; compacted_content: string }

interface McpTools {
    toolHealth:           (root: string) => string;
    toolIndexBuild:       (root: string) => string;
    toolIndexStatus:      (root: string) => string;
    toolGetText:          (root: string, args: GetTextInput) => string;
    toolGetChapter:       (root: string, args: GetChapterInput) => string;
    toolGetOverview:      (root: string, args: GetOverviewInput) => string;
    toolGetNotes:         (root: string, args: GetNotesInput) => string;
    toolSearch:           (root: string, args: SearchInput) => Promise<string>;
    toolRetrieveContext:  (root: string, args: RetrieveInput) => Promise<string>;
    toolFormat:           (root: string, args: FormatInput) => string;
    toolGetReviewText:    (root: string, args: GetReviewTextInput) => string;
    toolGitSnapshot:      (root: string, args: GitSnapshotInput) => string;
    toolAddTranslation:   (root: string, args: AddTranslationInput) => string;
    toolGetTranslation:   (root: string, args: GetTranslationInput) => string;
    toolInitWorkspace:    (root: string, args: InitWorkspaceInput) => string;
    toolSetupAiFiles:     (root: string, args: SetupAiFilesInput) => string;
    toolMemoryList:       (root: string) => string;
    toolMemoryAppend:     (root: string, args: MemoryAppendInput) => string;
    toolMemoryCompact:    (root: string, args: MemoryCompactInput) => string;
}

/**
 * Lazily load the compiled mcp-ts tools at runtime from the extension's
 * bundled output directory. This avoids a cross-project TypeScript import.
 */
function loadMcpTools(extensionPath: string): McpTools {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(path.join(extensionPath, 'mcp-ts', 'out', 'tools')) as McpTools;
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
            invoke: async (_opts, _token) => ok(t.toolHealth(requireRoot())),
        }),

        vscode.lm.registerTool('bindery_index_build', {
            invoke: async (_opts, _token) => ok(t.toolIndexBuild(requireRoot())),
        }),

        vscode.lm.registerTool('bindery_index_status', {
            invoke: async (_opts, _token) => ok(t.toolIndexStatus(requireRoot())),
        }),

        vscode.lm.registerTool<GetTextInput>('bindery_get_text', {
            invoke: async (opts, _token) => ok(t.toolGetText(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<GetChapterInput>('bindery_get_chapter', {
            invoke: async (opts, _token) => ok(t.toolGetChapter(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<GetOverviewInput>('bindery_get_overview', {
            invoke: async (opts, _token) => ok(t.toolGetOverview(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<GetNotesInput>('bindery_get_notes', {
            invoke: async (opts, _token) => ok(t.toolGetNotes(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<SearchInput>('bindery_search', {
            invoke: async (opts, _token) => ok(await t.toolSearch(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<RetrieveInput>('bindery_retrieve_context', {
            invoke: async (opts, _token) => ok(await t.toolRetrieveContext(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<FormatInput>('bindery_format', {
            invoke: async (opts, _token) => ok(t.toolFormat(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<GetReviewTextInput>('bindery_get_review_text', {
            invoke: async (opts, _token) => ok(t.toolGetReviewText(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<GitSnapshotInput>('bindery_git_snapshot', {
            invoke: async (opts, _token) => ok(t.toolGitSnapshot(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<AddTranslationInput>('bindery_add_translation', {
            invoke: async (opts, _token) => ok(t.toolAddTranslation(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<GetTranslationInput>('bindery_get_translation', {
            invoke: async (opts, _token) => ok(t.toolGetTranslation(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<InitWorkspaceInput>('bindery_init_workspace', {
            invoke: async (opts, _token) => ok(t.toolInitWorkspace(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<SetupAiFilesInput>('bindery_setup_ai_files', {
            invoke: async (opts, _token) => ok(t.toolSetupAiFiles(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool('bindery_memory_list', {
            invoke: async (_opts, _token) => ok(t.toolMemoryList(requireRoot())),
        }),

        vscode.lm.registerTool<MemoryAppendInput>('bindery_memory_append', {
            invoke: async (opts, _token) => ok(t.toolMemoryAppend(requireRoot(), opts.input)),
        }),

        vscode.lm.registerTool<MemoryCompactInput>('bindery_memory_compact', {
            invoke: async (opts, _token) => ok(t.toolMemoryCompact(requireRoot(), opts.input)),
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
export async function writeMcpJson(
    context:  vscode.ExtensionContext,
    root:     string,
): Promise<void> {
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

    await writeMcpJson(context, root);

    const action = await vscode.window.showInformationMessage(
        'Bindery MCP server registered in .vscode/mcp.json. Claude and Codex extensions will pick it up automatically.',
        'Open mcp.json'
    );
    if (action === 'Open mcp.json') {
        const mcpPath = path.join(root, '.vscode', 'mcp.json');
        vscode.window.showTextDocument(await vscode.workspace.openTextDocument(mcpPath));
    }
}
