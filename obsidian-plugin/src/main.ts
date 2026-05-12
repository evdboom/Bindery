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

    private async formatFolder(): Promise<void> {
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

        if (fs.existsSync(settingsPath)) {
            return; // already initialised
        }

        fs.mkdirSync(binderyFolder, { recursive: true });
        // Derive the default book title from the folder name (or vault name for root mode)
        const vaultName = trimmedBookRoot
            ? path.basename(bookPath)
            : this.app.vault.getName();
        const defaultSettings = {
            bookTitle:   vaultName,
            author:      '',
            storyFolder: 'Story',
            mergedOutputDir: 'Merged',
            mergeFilePrefix: 'Book',
            formatOnSave: false,
        };
        fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2) + '\n', 'utf-8');
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
