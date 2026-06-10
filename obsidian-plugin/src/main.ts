/**
 * Bindery Obsidian Plugin — main entry point.
 *
 * Registers commands, on-save hook, settings tab, and workspace init.
 *
 * NOTE: This file depends on the Obsidian runtime API which is injected
 * by the Obsidian desktop app. It cannot be unit-tested without mocking
 * the entire Obsidian module. Integration/manual testing is performed
 * inside the Obsidian app itself.
 */

import { BINDERY_FOLDER, SETTINGS_FILENAME, upsertGlossaryRule, getDefaultLanguage, applyTypography, readWorkspaceSettings, type LanguageConfig } from '@bindery/core';
import { mergeBook, type OutputType } from './merge';
import { formatFile } from './formatter';
import { resolveBookRoot } from './exporter';
import { setupAiFiles, ALL_SKILLS } from './ai-setup';
import { readSettings, addDialectRule, addLanguage, findProbableUsWords } from './workspace';
import { BinderySettingsTab, DEFAULT_SETTINGS, type BinderySettings } from './settings-tab';
import { App, Modal, Notice, Plugin, TFile } from 'obsidian';
import type { Editor } from 'obsidian';
import * as fs   from 'node:fs';
import * as path from 'node:path';

const REVIEW_START_MARKER = '<!-- Bindery: Review start -->';
const REVIEW_STOP_MARKER  = '<!-- Bindery: Review stop -->';

// Maps a SESSION.md section name (lowercased) to the session_focus_update argument key.
const SESSION_FOCUS_KEYS: Record<string, 'currentFocus' | 'nextActions' | 'openQuestions' | 'handoffNotes'> = {
    'current focus':  'currentFocus',
    'next actions':   'nextActions',
    'open questions': 'openQuestions',
    'handoff notes':  'handoffNotes',
};

// Type guard to check if an object is a TFile
function isTFile(obj: unknown): obj is TFile {
    return typeof obj === 'object' && obj !== null && 'extension' in obj && 'path' in obj;
}

class TextPromptModal extends Modal {
    private readonly titleText: string;
    private readonly defaultValue: string;
    private readonly onResolve: (_value: string | null) => void;
    private inputEl: HTMLInputElement | null = null;
    private resolved = false;

    constructor(app: App, titleText: string, defaultValue: string, onResolve: (_value: string | null) => void) {
        super(app);
        this.titleText = titleText;
        this.defaultValue = defaultValue;
        this.onResolve = onResolve;
    }

    onOpen(): void {
        this.titleEl.setText(this.titleText);
        this.contentEl.empty();

        const input = this.contentEl.createEl('input', { type: 'text', value: this.defaultValue });
        this.inputEl = input;
        input.addClass('mod-text-input');
        input.focus();
        input.select();
        input.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.resolveAndClose(input.value);
            }
        });

        const buttons = this.contentEl.createDiv({ cls: 'bindery-prompt-buttons' });
        const submitButton = buttons.createEl('button', { text: 'OK', cls: 'mod-cta' });
        submitButton.addEventListener('click', () => this.resolveAndClose(this.inputEl?.value ?? ''));

        const cancelButton = buttons.createEl('button', { text: 'Cancel' });
        cancelButton.addEventListener('click', () => this.resolveAndClose(null));
    }

    onClose(): void {
        if (!this.resolved) {
            this.onResolve(null);
        }
    }

    private resolveAndClose(value: string | null): void {
        if (this.resolved) {
            return;
        }
        this.resolved = true;
        this.onResolve(value);
        this.close();
    }
}

interface AuthoringCharacterInput {
    name: string;
    role?: string;
    firstAppearance?: string;
    background?: string;
    continuityNotes?: string;
}

interface AuthoringArcInput {
    path: string;
    title?: string;
    kind?: string;
    purpose?: string;
    majorBeats?: string;
    continuityRisks?: string;
}

interface AuthoringChapterStatusEntry {
    number: number;
    title: string;
    language: string;
    status: 'done' | 'in-progress' | 'draft' | 'planned' | 'needs-review';
    wordCount?: number;
    notes?: string;
}

interface AuthoringTools {
    toolInitWorkspace: (_root: string, _args: { bookTitle?: string; author?: string; storyFolder?: string }) => string;
    toolNoteList: (_root: string, _args: { category?: string }) => string;
    toolNoteGet: (_root: string, _args: { path: string }) => string;
    toolNoteCreate: (_root: string, _args: { path: string; title?: string; content?: string; overwrite?: boolean }) => string;
    toolNoteAppend: (_root: string, _args: { path: string; content: string; heading?: string }) => string;
    toolCharacterList: (_root: string, _args: { name?: string }) => string;
    toolCharacterGet: (_root: string, _args: { name: string }) => string;
    toolCharacterCreate: (_root: string, _args: AuthoringCharacterInput) => string;
    toolCharacterUpdate: (_root: string, _args: AuthoringCharacterInput) => string;
    toolArcList: (_root: string, _args: { kind?: string }) => string;
    toolArcGet: (_root: string, _args: { path: string }) => string;
    toolArcCreate: (_root: string, _args: AuthoringArcInput) => string;
    toolArcUpdate: (_root: string, _args: AuthoringArcInput) => string;
    toolMemoryList: (_root: string) => string;
    toolMemoryAppend: (_root: string, _args: { file: string; title: string; content: string }) => string;
    toolMemoryCompact: (_root: string, _args: { file: string; compacted_content: string }) => string;
    toolChapterStatusGet: (_root: string) => string;
    toolChapterStatusUpdate: (_root: string, _args: { chapters: AuthoringChapterStatusEntry[] }) => string;
    toolSessionFocusGet: (_root: string, _args: { section?: string }) => string;
    toolSessionFocusUpdate: (_root: string, _args: { currentFocus?: string; nextActions?: string; openQuestions?: string; handoffNotes?: string; mode?: 'replace' | 'append' }) => string;
    toolInboxProcess: (_root: string) => string;
    toolInboxResolve: (_root: string, _args: { items: number[] }) => string;
}

function loadAuthoringTools(): AuthoringTools {
    try {
        // Keep this literal so esbuild can bundle the shared tools into the Obsidian plugin release.
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime bridge to shared MCP tool module
        return require('../../mcp-ts/out/tools') as AuthoringTools;
    } catch {
        // Fall back to runtime paths for local development and manually copied release layouts.
    }

    const candidates = [
        path.join(__dirname, 'mcp-ts', 'out', 'tools'),
        path.join(__dirname, '..', 'mcp-ts', 'out', 'tools'),
        path.join(__dirname, '..', '..', 'mcp-ts', 'out', 'tools'),
    ];
    const modulePath = candidates.find(candidate => fs.existsSync(candidate + '.js'));
    if (!modulePath) {
        throw new Error('Compiled Bindery authoring tools were not found. Run npm run compile --workspace=mcp-ts before using authoring commands.');
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime bridge to shared MCP tool module
    return require(modulePath) as AuthoringTools;
}

export default class BinderyPlugin extends Plugin {
    settings: BinderySettings = { ...DEFAULT_SETTINGS };

    private notify(message: string): void {
        // Prefer user-facing notices to console logs to keep the developer console clean.
        new Notice(message);
    }

    private addContextMenuItems(menu: unknown, forEditor: boolean): void {
        const m = menu as {
            addSeparator?: () => void;
            addItem: (_cb: (_item: {
                setTitle: (_title: string) => unknown;
                setIcon?: (_icon: string) => unknown;
                onClick: (_fn: () => void) => unknown;
            }) => void) => void;
        };

        m.addSeparator?.();

        m.addItem((item) => {
            item.setTitle('Merge chapters to all formats');
            item.setIcon?.('book-open');
            item.onClick(() => { void this.mergeBook(['md', 'docx', 'epub', 'pdf']); });
        });

        if (forEditor) {
            m.addItem((item) => {
                item.setTitle('Format document');
                item.setIcon?.('wand');
                item.onClick(() => { void this.formatActive(); });
            });
        }

        m.addItem((item) => {
            item.setTitle('Find probable us to uk words');
            item.setIcon?.('languages');
            item.onClick(() => { void this.findUsToUkCommand(); });
        });

        m.addItem((item) => {
            item.setTitle('Generate AI assistant files');
            item.setIcon?.('sparkles');
            item.onClick(() => { void this.setupAiCommand(); });
        });
    }

    private getVaultBasePath(): string {
        const basePath = this.app.vault.adapter?.basePath;
        if (typeof basePath !== 'string' || !basePath.trim()) {
            throw new Error('Vault adapter basePath is unavailable. Desktop vault path is required.');
        }
        return basePath;
    }

    async onload(): Promise<void> {
        await this.loadSettings();

        // Format on save — only fires for files inside the configured book root
        this.registerEvent(
            this.app.vault.on('modify', (...args: unknown[]) => {
                const arg = args[0];
                if (!isTFile(arg)) { return; }
                const file = arg;
                if (!this.settings.formatOnSave || file.extension !== 'md') { return; }

                let vaultPath: string;
                let bookRoot: string;
                try {
                    vaultPath = this.getVaultBasePath();
                    bookRoot = resolveBookRoot(vaultPath, this.settings.bookRoot);
                } catch {
                    return;
                }

                // Normalise separators for reliable prefix matching
                const absFile = path.join(vaultPath, file.path);
                if (!absFile.startsWith(bookRoot + path.sep) && absFile !== bookRoot) { return; }
                void formatFile(this.app.vault, file).catch(() => {
                    // Keep save hooks resilient; formatting errors should not break save flow.
                });
            }),
        );

        // Command: format active document
        this.addCommand({
            id:       'format-document',
            name:     'Format document',
            callback: () => void this.formatActive(),
        });

        // Command: format all markdown files in a folder
        this.addCommand({
            id:       'format-folder',
            name:     'Format folder (all .md files)',
            callback: () => void this.formatFolder(),
        });

        // Review marker commands
        this.addCommand({
            id:   'start-review-marker',
            name: 'Insert review start marker (or wrap selection)',
            editorCallback: (editor) => this.insertStartReviewMarker(editor),
        });
        this.addCommand({
            id:   'stop-review-marker',
            name: 'Insert review stop marker',
            editorCallback: (editor) => this.insertStopReviewMarker(editor),
        });

        // Merge commands
        for (const fmt of ['md', 'docx', 'epub', 'pdf', 'all'] as const) {
            const outputTypes = fmt === 'all' ? ['md', 'docx', 'epub', 'pdf'] : [fmt];
            const label = fmt === 'all' ? 'All Formats' : fmt.toUpperCase();
            this.addCommand({
                id:       `merge-${fmt}`,
                name:     `Merge chapters → ${label}`,
                callback: () => void this.mergeBook(outputTypes as OutputType[]),
            });
        }

        // Init workspace
        this.addCommand({
            id:       'init-workspace',
            name:     'Initialize workspace',
            callback: () => this.initWorkspace(),
        });

        // AI setup command
        this.addCommand({
            id:       'setup-ai-files',
            name:     'Generate AI assistant files',
            callback: () => void this.setupAiCommand(),
        });

        // Workspace management commands
        this.addCommand({
            id:       'add-dialect',
            name:     'Add dialect rule',
            callback: () => void this.addDialectCommand(),
        });
        this.addCommand({
            id:       'add-translation',
            name:     'Add translation glossary entry',
            callback: () => void this.addTranslationCommand(),
        });
        this.addCommand({
            id:       'add-language',
            name:     'Add language',
            callback: () => void this.addLanguageCommand(),
        });
        this.addCommand({
            id:       'open-translations',
            name:     'Open translations file',
            callback: () => this.openTranslationsCommand(),
        });
        this.addCommand({
            id:       'find-us-to-uk-words',
            name:     'Find probable us to uk words',
            callback: () => void this.findUsToUkCommand(),
        });

        // Authoring tool commands: mirrors the MCP/LM authoring surface.
        this.addCommand({ id: 'note-list', name: 'List notes', callback: () => void this.noteListCommand() });
        this.addCommand({ id: 'note-get', name: 'Open note tool output', callback: () => void this.noteGetCommand() });
        this.addCommand({ id: 'note-create', name: 'Create note', callback: () => void this.noteCreateCommand() });
        this.addCommand({ id: 'note-append', name: 'Append to note', callback: () => void this.noteAppendCommand() });
        this.addCommand({ id: 'character-list', name: 'List characters', callback: () => void this.characterListCommand() });
        this.addCommand({ id: 'character-get', name: 'Open character tool output', callback: () => void this.characterGetCommand() });
        this.addCommand({ id: 'character-create', name: 'Create character profile', callback: () => void this.characterCreateCommand() });
        this.addCommand({ id: 'character-update', name: 'Update character profile', callback: () => void this.characterUpdateCommand() });
        this.addCommand({ id: 'arc-list', name: 'List arcs', callback: () => void this.arcListCommand() });
        this.addCommand({ id: 'arc-get', name: 'Open arc tool output', callback: () => void this.arcGetCommand() });
        this.addCommand({ id: 'arc-create', name: 'Create arc file', callback: () => void this.arcCreateCommand() });
        this.addCommand({ id: 'arc-update', name: 'Update arc file', callback: () => void this.arcUpdateCommand() });
        this.addCommand({ id: 'memory-list', name: 'List memories', callback: () => void this.memoryListCommand() });
        this.addCommand({ id: 'memory-append', name: 'Append memory', callback: () => void this.memoryAppendCommand() });
        this.addCommand({ id: 'memory-compact', name: 'Compact memory', callback: () => void this.memoryCompactCommand() });
        this.addCommand({ id: 'chapter-status-get', name: 'Show chapter status', callback: () => void this.chapterStatusGetCommand() });
        this.addCommand({ id: 'chapter-status-update', name: 'Update chapter status', callback: () => void this.chapterStatusUpdateCommand() });
        this.addCommand({ id: 'session-focus-show', name: 'Show session focus', callback: () => void this.sessionFocusShowCommand() });
        this.addCommand({ id: 'session-focus-update', name: 'Update session focus', callback: () => void this.sessionFocusUpdateCommand() });
        this.addCommand({ id: 'session-focus-append-handoff', name: 'Append handoff note', callback: () => void this.sessionFocusAppendHandoffCommand() });
        this.addCommand({ id: 'inbox-process', name: 'Process inbox', callback: () => void this.inboxProcessCommand() });
        this.addCommand({ id: 'inbox-resolve', name: 'Resolve inbox items', callback: () => void this.inboxResolveCommand() });

        // Show MCP config snippet — copies JSON to clipboard
        this.addCommand({
            id:       'show-mcp-config',
            name:     'Show mcp config snippet',
            callback: () => void this.copyMcpSnippet(),
        });

        this.addRibbonIcon('book-open', 'Merge chapters to all formats', () => {
            void this.mergeBook(['md', 'docx', 'epub', 'pdf']);
        });
        this.addRibbonIcon('wand', 'Format active note', () => {
            void this.formatActive();
        });
        this.addRibbonIcon('languages', 'Find probable us to uk words', () => {
            void this.findUsToUkCommand();
        });

        // Right-click menus in editor and file explorer.
        if (this.app.workspace) {
            this.registerEvent(this.app.workspace.on('editor-menu', (menu: unknown) => {
                this.addContextMenuItems(menu, true);
            }));
            this.registerEvent(this.app.workspace.on('file-menu', (menu: unknown) => {
                this.addContextMenuItems(menu, false);
            }));
        }

        this.addSettingTab(new BinderySettingsTab(this.app, this));
    }

    private async mergeBook(outputTypes: OutputType[]): Promise<void> {
        try {
            const vaultPath = this.getVaultBasePath();
            const bookRoot = resolveBookRoot(vaultPath, this.settings.bookRoot);

            const result = await mergeBook(
                this.app,
                this.app.vault,
                vaultPath,
                bookRoot,
                this.settings,
                outputTypes
            );

            const names = result.outputs.map((p: string) => path.basename(p)).join(', ');
            this.notify(`Merged: ${names}`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`✗ Merge failed: ${message}`);
            this.notify(`Merge failed: ${message}`);
        }
    }

    private formatFolder(): void {
        let vaultPath: string;
        let bookRoot: string;
        try {
            vaultPath = this.getVaultBasePath();
            bookRoot = resolveBookRoot(vaultPath, this.settings.bookRoot);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.notify(`Format folder failed: ${message}`);
            return;
        }
        const wsSettings = readWorkspaceSettings(bookRoot);
        const storyFolder = wsSettings?.storyFolder ?? 'Story';
        const targetDir = path.join(bookRoot, storyFolder);
        if (!fs.existsSync(targetDir)) {
            this.notify(`Story folder not found: ${storyFolder}`);
            return;
        }
        const count = this.formatDirectoryRecursive(targetDir);
        this.notify(`Typography: ${count} file(s) updated.`);
    }

    private formatDirectoryRecursive(dirPath: string): number {
        let count = 0;
        for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                count += this.formatDirectoryRecursive(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
                const content   = fs.readFileSync(fullPath, 'utf-8');
                const formatted = applyTypography(content);
                if (content !== formatted) {
                    fs.writeFileSync(fullPath, formatted, 'utf-8');
                    count++;
                }
            }
        }
        return count;
    }

    private async formatActive(): Promise<void> {
        const file = this.app.workspace?.getActiveFile?.();
        if (file?.extension !== 'md') {
            this.notify('No markdown file active');
            return;
        }
        try {
            await formatFile(this.app.vault, file);
            this.notify('Formatted active note');
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`✗ Format failed: ${message}`);
            this.notify(`Format failed: ${message}`);
        }
    }

    private setupAiCommand(): void {
        try {
            const vaultPath = this.getVaultBasePath();
            const bookRoot = resolveBookRoot(vaultPath, this.settings.bookRoot);

            const result = setupAiFiles(this.app, bookRoot, ['claude', 'copilot', 'cursor', 'agents'], ALL_SKILLS, false);
            const msg = `Generated: ${result.created.length}, Skipped: ${result.skipped.length}`;
            this.notify(`AI setup complete. ${msg}`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`✗ AI setup failed: ${message}`);
            this.notify(`AI setup failed: ${message}`);
        }
    }

    private async addDialectCommand(): Promise<void> {
        try {
            const vaultPath = this.getVaultBasePath();
            const bookRoot = resolveBookRoot(vaultPath, this.settings.bookRoot);

            const language = await this.promptString('Language code (e.g. EN, NL):', 'EN');
            if (!language) return;

            const from = await this.promptString('US spelling:', '');
            if (!from) return;

            const to = await this.promptString('UK/Target spelling:', '');
            if (!to) return;

            addDialectRule(bookRoot, language, from, to);
            this.notify(`Added dialect rule: ${from} -> ${to}`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`✗ Failed: ${message}`);
            this.notify(`Action failed: ${message}`);
        }
    }

    private async addTranslationCommand(): Promise<void> {
        try {
            const vaultPath = this.getVaultBasePath();
            const bookRoot = resolveBookRoot(vaultPath, this.settings.bookRoot);
            const settings = readSettings(bookRoot);
            if (!settings?.languages) throw new Error('No languages configured');

            const sourceLang = getDefaultLanguage(settings);
            if (!sourceLang) throw new Error('No default language configured. Run Bindery: Initialize Workspace first.');

            const targetLangs = settings.languages.filter(
                (l: LanguageConfig) => !l.isDefault && l.code !== sourceLang.code
            );
            if (targetLangs.length === 0) {
                throw new Error('No target languages configured. Use Bindery: Add Language to add one.');
            }

            const fromWord = await this.promptString(`Term in ${sourceLang.code}:`, '');
            if (!fromWord) return;

            for (const lang of targetLangs) {
                const toWord = await this.promptString(`${lang.code} equivalent for "${fromWord}":`, '');
                if (!toWord) continue;
                const langKey = lang.code.toLowerCase();
                upsertGlossaryRule(bookRoot, langKey, lang.folderName, sourceLang.code, { from: fromWord, to: toWord });
            }

            this.notify(`Added glossary entry: ${fromWord}`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`✗ Failed: ${message}`);
            this.notify(`Action failed: ${message}`);
        }
    }

    private async addLanguageCommand(): Promise<void> {
        try {
            const vaultPath = this.getVaultBasePath();
            const bookRoot = resolveBookRoot(vaultPath, this.settings.bookRoot);

            const code = await this.promptString('Language code (e.g. NL, FR, DE):', '');
            if (!code) return;

            const folderName = await this.promptString('Folder name:', code);
            if (!folderName) return;

            addLanguage(bookRoot, code, folderName);
            this.notify(`Added language: ${code}`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`✗ Failed: ${message}`);
            this.notify(`Action failed: ${message}`);
        }
    }

    private openTranslationsCommand(): void {
        try {
            const vaultPath = this.getVaultBasePath();
            const bookRoot = resolveBookRoot(vaultPath, this.settings.bookRoot);
            const translationsPath = path.join(bookRoot, '.bindery', 'translations.json');

            if (!fs.existsSync(translationsPath)) {
                this.notify('translations.json not found');
                return;
            }

            this.notify(`Translations file: ${translationsPath}`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`✗ Failed: ${message}`);
            this.notify(`Action failed: ${message}`);
        }
    }

    private async findUsToUkCommand(): Promise<void> {
        try {
            const file = this.app.workspace?.getActiveFile?.();
            if (!file) {
                this.notify('No file active');
                return;
            }

            const content = await this.app.vault.read(file);
            const words = findProbableUsWords(content);

            if (words.length === 0) {
                this.notify('No probable US words found');
                return;
            }

            const list = words.slice(0, 10).join(', ') + (words.length > 10 ? `, +${words.length - 10} more` : '');
            this.notify(`Found: ${list}`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`✗ Failed: ${message}`);
            this.notify(`Action failed: ${message}`);
        }
    }

    private getBookRoot(): string {
        const vaultPath = this.getVaultBasePath();
        return resolveBookRoot(vaultPath, this.settings.bookRoot);
    }

    private async copyText(text: string): Promise<boolean> {
        const activeWindow = this.app.workspace?.containerEl.ownerDocument.defaultView;
        const clipboard = activeWindow?.navigator?.clipboard;
        if (!clipboard?.writeText) { return false; }
        await clipboard.writeText(text);
        return true;
    }

    private async showAuthoringResult(title: string, result: string): Promise<void> {
        const text = result.trim() || '(no output)';
        if (text.length > 250 || text.includes('\n')) {
            const copied = await this.copyText(text);
            this.notify(copied ? `${title}: copied result to clipboard` : `${title}: ${text.slice(0, 220)}`);
            return;
        }
        this.notify(`${title}: ${text}`);
    }

    private async runAuthoringCommand(
        title: string,
        callback: (_root: string, _tools: AuthoringTools) => Promise<string | null> | string | null,
    ): Promise<void> {
        try {
            const result = await callback(this.getBookRoot(), loadAuthoringTools());
            if (result !== null) { await this.showAuthoringResult(title, result); }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`✗ ${title} failed: ${message}`);
            this.notify(`${title} failed: ${message}`);
        }
    }

    private async promptRequired(promptText: string, defaultValue = ''): Promise<string | null> {
        const value = await this.promptString(promptText, defaultValue);
        if (value === null) { return null; }
        const trimmed = value.trim();
        if (!trimmed) {
            this.notify(`${promptText} is required`);
            return null;
        }
        return trimmed;
    }

    private async promptOptional(promptText: string, defaultValue = ''): Promise<string | undefined | null> {
        const value = await this.promptString(promptText, defaultValue);
        if (value === null) { return null; }
        return value.trim() || undefined;
    }

    private async promptCharacterInput(update: boolean): Promise<AuthoringCharacterInput | null> {
        const name = await this.promptRequired('Character name:');
        if (!name) { return null; }
        const role = await this.promptOptional('Role (optional):');
        if (role === null) { return null; }
        const firstAppearance = await this.promptOptional('First appearance (optional):');
        if (firstAppearance === null) { return null; }
        const background = await this.promptOptional('Background or notes (optional):');
        if (background === null) { return null; }
        const continuityNotes = update ? await this.promptOptional('Continuity notes (optional):') : undefined;
        if (continuityNotes === null) { return null; }
        return { name, role, firstAppearance, background, continuityNotes };
    }

    private async promptArcInput(update: boolean): Promise<AuthoringArcInput | null> {
        const arcPath = await this.promptRequired('Arc path relative to Arc folder:', update ? '' : 'Acts/Act_I.md');
        if (!arcPath) { return null; }
        const title = await this.promptOptional('Title (optional):');
        if (title === null) { return null; }
        const kind = await this.promptOptional('Kind (overall, act, chapter, thread, custom; optional):');
        if (kind === null) { return null; }
        const purpose = await this.promptOptional('Purpose (optional):');
        if (purpose === null) { return null; }
        const majorBeats = await this.promptOptional('Major beats (optional):');
        if (majorBeats === null) { return null; }
        const continuityRisks = update ? await this.promptOptional('Continuity risks (optional):') : undefined;
        if (continuityRisks === null) { return null; }
        return { path: arcPath, title, kind, purpose, majorBeats, continuityRisks };
    }

    private async promptChapterStatusEntry(): Promise<AuthoringChapterStatusEntry | null> {
        const chapterNumberRaw = await this.promptRequired('Chapter number:');
        if (!chapterNumberRaw) { return null; }
        const chapterNumber = Number(chapterNumberRaw);
        if (!Number.isInteger(chapterNumber) || chapterNumber < 0) {
            this.notify('Chapter number must be a non-negative integer');
            return null;
        }

        const title = await this.promptRequired('Chapter title:');
        if (!title) { return null; }
        const language = await this.promptOptional('Language code:', 'EN');
        if (language === null) { return null; }
        const status = await this.promptRequired('Status (done, in-progress, needs-review, draft, planned):', 'draft');
        if (!status) { return null; }
        if (!['done', 'in-progress', 'needs-review', 'draft', 'planned'].includes(status)) {
            this.notify('Invalid chapter status');
            return null;
        }
        const wordCountRaw = await this.promptOptional('Word count (optional):');
        if (wordCountRaw === null) { return null; }
        const notes = await this.promptOptional('Notes (optional):');
        if (notes === null) { return null; }
        let wordCount: number | undefined;
        if (wordCountRaw) {
            const parsedWordCount = Number(wordCountRaw);
            if (!Number.isInteger(parsedWordCount) || parsedWordCount < 0) {
                this.notify('Word count must be a non-negative integer');
                return null;
            }
            wordCount = parsedWordCount;
        }
        return { number: chapterNumber, title, language: language ?? 'EN', status: status as AuthoringChapterStatusEntry['status'], wordCount, notes };
    }

    private async noteListCommand(): Promise<void> {
        await this.runAuthoringCommand('Note list', (root, tools) => tools.toolNoteList(root, {}));
    }

    private async noteGetCommand(): Promise<void> {
        await this.runAuthoringCommand('Note get', async (root, tools) => {
            const notePath = await this.promptRequired('Note path relative to Notes folder:');
            return notePath ? tools.toolNoteGet(root, { path: notePath }) : null;
        });
    }

    private async noteCreateCommand(): Promise<void> {
        await this.runAuthoringCommand('Note create', async (root, tools) => {
            const notePath = await this.promptRequired('Note path relative to Notes folder:', 'Inbox.md');
            if (!notePath) { return null; }
            const title = await this.promptOptional('Title (optional):');
            if (title === null) { return null; }
            const content = await this.promptOptional('Initial content (optional):');
            if (content === null) { return null; }
            return tools.toolNoteCreate(root, { path: notePath, title, content });
        });
    }

    private async noteAppendCommand(): Promise<void> {
        await this.runAuthoringCommand('Note append', async (root, tools) => {
            const notePath = await this.promptRequired('Note path relative to Notes folder:', 'Inbox.md');
            if (!notePath) { return null; }
            const heading = await this.promptOptional('Heading (optional):');
            if (heading === null) { return null; }
            const content = await this.promptRequired('Content to append:');
            return content ? tools.toolNoteAppend(root, { path: notePath, heading, content }) : null;
        });
    }

    private async characterListCommand(): Promise<void> {
        await this.runAuthoringCommand('Character list', (root, tools) => tools.toolCharacterList(root, {}));
    }

    private async characterGetCommand(): Promise<void> {
        await this.runAuthoringCommand('Character get', async (root, tools) => {
            const name = await this.promptRequired('Character name:');
            return name ? tools.toolCharacterGet(root, { name }) : null;
        });
    }

    private async characterCreateCommand(): Promise<void> {
        await this.runAuthoringCommand('Character create', async (root, tools) => {
            const input = await this.promptCharacterInput(false);
            return input ? tools.toolCharacterCreate(root, input) : null;
        });
    }

    private async characterUpdateCommand(): Promise<void> {
        await this.runAuthoringCommand('Character update', async (root, tools) => {
            const input = await this.promptCharacterInput(true);
            return input ? tools.toolCharacterUpdate(root, input) : null;
        });
    }

    private async arcListCommand(): Promise<void> {
        await this.runAuthoringCommand('Arc list', (root, tools) => tools.toolArcList(root, {}));
    }

    private async arcGetCommand(): Promise<void> {
        await this.runAuthoringCommand('Arc get', async (root, tools) => {
            const arcPath = await this.promptRequired('Arc path relative to Arc folder:');
            return arcPath ? tools.toolArcGet(root, { path: arcPath }) : null;
        });
    }

    private async arcCreateCommand(): Promise<void> {
        await this.runAuthoringCommand('Arc create', async (root, tools) => {
            const input = await this.promptArcInput(false);
            return input ? tools.toolArcCreate(root, input) : null;
        });
    }

    private async arcUpdateCommand(): Promise<void> {
        await this.runAuthoringCommand('Arc update', async (root, tools) => {
            const input = await this.promptArcInput(true);
            return input ? tools.toolArcUpdate(root, input) : null;
        });
    }

    private async memoryListCommand(): Promise<void> {
        await this.runAuthoringCommand('Memory list', (root, tools) => tools.toolMemoryList(root));
    }

    private async memoryAppendCommand(): Promise<void> {
        await this.runAuthoringCommand('Memory append', async (root, tools) => {
            const file = await this.promptRequired('Memory file:', 'global.md');
            if (!file) { return null; }
            const title = await this.promptRequired('Session title:');
            if (!title) { return null; }
            const content = await this.promptRequired('Memory content:');
            return content ? tools.toolMemoryAppend(root, { file, title, content }) : null;
        });
    }

    private async memoryCompactCommand(): Promise<void> {
        await this.runAuthoringCommand('Memory compact', async (root, tools) => {
            const file = await this.promptRequired('Memory file:', 'global.md');
            if (!file) { return null; }
            const compactedContent = await this.promptRequired('Compacted content:');
            return compactedContent ? tools.toolMemoryCompact(root, { file, compacted_content: compactedContent }) : null;
        });
    }

    private async chapterStatusGetCommand(): Promise<void> {
        await this.runAuthoringCommand('Chapter status', (root, tools) => tools.toolChapterStatusGet(root));
    }

    private async chapterStatusUpdateCommand(): Promise<void> {
        await this.runAuthoringCommand('Chapter status update', async (root, tools) => {
            const entry = await this.promptChapterStatusEntry();
            return entry ? tools.toolChapterStatusUpdate(root, { chapters: [entry] }) : null;
        });
    }

    private async sessionFocusShowCommand(): Promise<void> {
        await this.runAuthoringCommand('Session focus', async (root, tools) => {
            const section = await this.promptOptional('Section to show (blank = whole file):');
            if (section === null) { return null; }
            return tools.toolSessionFocusGet(root, { section });
        });
    }

    private async sessionFocusUpdateCommand(): Promise<void> {
        await this.runAuthoringCommand('Session focus update', async (root, tools) => {
            const section = await this.promptRequired('Section (Current Focus, Next Actions, Open Questions, Handoff Notes):', 'Current Focus');
            if (!section) { return null; }
            const key = SESSION_FOCUS_KEYS[section.trim().toLowerCase()];
            if (!key) { this.notify('Unknown section. Use Current Focus, Next Actions, Open Questions, or Handoff Notes.'); return null; }
            const content = await this.promptRequired('New content:');
            if (!content) { return null; }
            const mode = await this.promptOptional('Mode (replace or append):', 'replace');
            if (mode === null) { return null; }
            const resolvedMode = mode === 'append' ? 'append' : 'replace';
            return tools.toolSessionFocusUpdate(root, { [key]: content, mode: resolvedMode });
        });
    }

    private async sessionFocusAppendHandoffCommand(): Promise<void> {
        await this.runAuthoringCommand('Append handoff note', async (root, tools) => {
            const content = await this.promptRequired('Handoff note to append:');
            return content ? tools.toolSessionFocusUpdate(root, { handoffNotes: content, mode: 'append' }) : null;
        });
    }

    private async inboxProcessCommand(): Promise<void> {
        await this.runAuthoringCommand('Process inbox', (root, tools) => tools.toolInboxProcess(root));
    }

    private async inboxResolveCommand(): Promise<void> {
        await this.runAuthoringCommand('Resolve inbox items', async (root, tools) => {
            const raw = await this.promptRequired('Item numbers to remove (comma-separated):');
            if (!raw) { return null; }
            const items = raw.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0);
            if (items.length === 0) { this.notify('Enter one or more item numbers, e.g. "1, 3".'); return null; }
            return tools.toolInboxResolve(root, { items });
        });
    }

    private async promptString(promptText: string, defaultValue: string = ''): Promise<string | null> {
        return new Promise((resolve) => {
            new TextPromptModal(this.app, promptText, defaultValue, resolve).open();
        });
    }

    private insertStartReviewMarker(editor: Editor): void {
        if (!this.isMarkdownActive()) {
            return;
        }

        const selection = editor.getSelection();
        if (selection.length > 0) {
            const start = editor.getCursor('from');
            const end = editor.getCursor('to');
            const startWrap = this.lineBoundaryWrap(editor, start.line, start.ch, REVIEW_START_MARKER);
            const stopWrap = this.lineBoundaryWrap(editor, end.line, end.ch, REVIEW_STOP_MARKER);
            editor.replaceSelection(`${startWrap}${selection}${stopWrap}`);
            return;
        }

        const pos = editor.getCursor();
        editor.replaceRange(this.lineBoundaryWrap(editor, pos.line, pos.ch, REVIEW_START_MARKER), pos);
    }

    private insertStopReviewMarker(editor: Editor): void {
        if (!this.isMarkdownActive()) {
            return;
        }
        const pos = editor.getCursor();
        editor.replaceRange(this.lineBoundaryWrap(editor, pos.line, pos.ch, REVIEW_STOP_MARKER), pos);
    }

    private lineBoundaryWrap(editor: Editor, line: number, ch: number, marker: string): string {
        const lineText = editor.getLine(line);
        const atLineStart = ch === 0;
        const atLineEnd = ch === lineText.length;
        const prefix = atLineStart ? '' : '\n';
        const suffix = atLineEnd ? '' : '\n';
        return `${prefix}${marker}${suffix}`;
    }

    private isMarkdownActive(): boolean {
        const active = this.app.workspace?.getActiveFile();
        return active?.extension === 'md';
    }

    private initWorkspace(): void {
        const vaultPath     = this.getVaultBasePath();
        const trimmedBookRoot = this.settings.bookRoot.trim();
        const bookPath      = resolveBookRoot(vaultPath, trimmedBookRoot);
        const binderyFolder = path.join(bookPath, BINDERY_FOLDER);
        const settingsPath  = path.join(binderyFolder, SETTINGS_FILENAME);

        const isNew = !fs.existsSync(settingsPath);

        // Derive the default book title from the folder name (or vault name for root mode)
        const vaultName = trimmedBookRoot
            ? path.basename(bookPath)
            : this.app.vault.getName();
        try {
            loadAuthoringTools().toolInitWorkspace(bookPath, isNew ? {
                bookTitle: vaultName,
                author: '',
                storyFolder: 'Story',
            } : {});
        } catch {
            if (!isNew) { return; } // already initialised — skip fallback for re-init
            fs.mkdirSync(binderyFolder, { recursive: true });
            const defaultSettings = {
                bookTitle:   vaultName,
                author:      '',
                storyFolder: 'Story',
                notesFolder: 'Notes',
                arcFolder: 'Arc',
                charactersFolder: 'Notes/Characters',
                sessionFile: 'SESSION.md',
                preferencesFile: 'PREFERENCES.md',
                mergedOutputDir: 'Merged',
                mergeFilePrefix: 'Book',
                formatOnSave: false,
            };
            fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2) + '\n', 'utf-8');
            const writeIfMissing = (filePath: string, content: string): void => {
                if (fs.existsSync(filePath)) { return; }
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.writeFileSync(filePath, content, 'utf-8');
            };
            writeIfMissing(path.join(binderyFolder, 'translations.json'), JSON.stringify({ 'en-gb': { label: 'British English', type: 'substitution', sourceLanguage: 'en', rules: [], ignoredWords: [] } }, null, 2) + '\n');
            fs.mkdirSync(path.join(bookPath, 'Story', 'EN'), { recursive: true });
            fs.mkdirSync(path.join(bookPath, 'Arc', 'Acts'), { recursive: true });
            fs.mkdirSync(path.join(bookPath, 'Notes', 'Characters'), { recursive: true });
            fs.mkdirSync(path.join(bookPath, '.bindery', 'memories', 'archive'), { recursive: true });
            writeIfMissing(path.join(bookPath, 'SESSION.md'), `# Session — ${vaultName}\n\n## Current Focus\n\n\n## Next Actions\n\n\n## Open Questions\n\n\n## Handoff Notes\n\n`);
            writeIfMissing(path.join(bookPath, 'PREFERENCES.md'), `# Preferences — ${vaultName}\n\n## Working Style\n\n\n## Writing Conventions\n\n\n## Review Preferences\n\n\n## Collaboration Notes\n\n`);
            writeIfMissing(path.join(bookPath, 'Arc', 'Overall.md'), '# Overall Arc\n');
            writeIfMissing(path.join(bookPath, 'Notes', 'Inbox.md'), '# Inbox\n');
            writeIfMissing(path.join(bookPath, 'Notes', 'Characters', 'index.md'), '# Character Index\n');
            writeIfMissing(path.join(bookPath, '.bindery', 'memories', 'global.md'), `# Global Memory - ${vaultName}\n`);
            writeIfMissing(path.join(bookPath, '.bindery', 'chapter-status.json'), JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString().slice(0, 10), chapters: [] }, null, 2) + '\n');
        }
    }

    private async copyMcpSnippet(): Promise<void> {
        const snippet = this.showMcpSnippet();
        const activeWindow = this.app.workspace?.containerEl.ownerDocument.defaultView;
        const clipboard = activeWindow?.navigator?.clipboard;
        if (clipboard?.writeText) {
            await clipboard.writeText(snippet);
            return;
        }
        this.notify('Clipboard unavailable; unable to copy MCP snippet.');
    }

    showMcpSnippet(): string {
        const vaultPath = this.getVaultBasePath();
        const trimmedBookRoot = this.settings.bookRoot.trim();
        const bookPath  = resolveBookRoot(vaultPath, trimmedBookRoot);
        const bookName  = trimmedBookRoot
            ? path.basename(bookPath)
            : this.app.vault.getName();
        const snippet   = JSON.stringify({
            mcpServers: {
                bindery: {
                    command: 'node',
                    args: [
                        '/path/to/bindery-mcp/out/index.js',
                        '--book',
                        `${bookName}=${bookPath}`,
                    ],
                },
            },
        }, null, 2);
        return snippet;
    }

    async loadSettings(): Promise<void> {
        const loaded = await this.loadData() as Partial<BinderySettings> | null;
        this.settings = loaded
            ? { ...DEFAULT_SETTINGS, ...loaded }
            : { ...DEFAULT_SETTINGS };
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }
}

// Re-export for consumers (e.g. settings tab, tests)
export { readWorkspaceSettings } from '@bindery/core';
