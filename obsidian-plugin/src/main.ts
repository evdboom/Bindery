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

import { BINDERY_FOLDER, SETTINGS_FILENAME } from '@bindery/core';
import { formatFile } from './formatter';
import { exportBook, resolveBookRoot } from './exporter';
import { BinderySettingsTab, DEFAULT_SETTINGS, type BinderySettings } from './settings-tab';
import { Plugin } from 'obsidian';
import type { Editor, TFile } from 'obsidian';
import * as fs   from 'node:fs';
import * as path from 'node:path';

const REVIEW_START_MARKER = '<!-- Bindery: Review start -->';
const REVIEW_STOP_MARKER  = '<!-- Bindery: Review stop -->';

export default class BinderyPlugin extends Plugin {
    settings: BinderySettings = { ...DEFAULT_SETTINGS };

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
                const file = args[0] as TFile;
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
            name:     'Bindery: Format document',
            callback: () => void this.formatActive(),
        });

        // Review marker commands
        this.addCommand({
            id:   'start-review-marker',
            name: 'Bindery: Insert Review Start Marker (or wrap selection)',
            editorCallback: (editor) => this.insertStartReviewMarker(editor),
        });
        this.addCommand({
            id:   'stop-review-marker',
            name: 'Bindery: Insert Review Stop Marker',
            editorCallback: (editor) => this.insertStopReviewMarker(editor),
        });

        // Export commands
        for (const fmt of ['md', 'docx', 'epub', 'pdf'] as const) {
            const label = fmt.toUpperCase();
            this.addCommand({
                id:       `export-${fmt}`,
                name:     `Bindery: Export → ${label}`,
                callback: () => void exportBook(this.app, this.settings, fmt),
            });
        }

        // Init workspace
        this.addCommand({
            id:       'init-workspace',
            name:     'Bindery: Initialize workspace',
            callback: () => void this.initWorkspace(),
        });

        // Show MCP config snippet — copies JSON to clipboard
        this.addCommand({
            id:       'show-mcp-config',
            name:     'Bindery: Show MCP config snippet',
            callback: () => void this.copyMcpSnippet(),
        });

        this.addSettingTab(new BinderySettingsTab(this.app, this));
    }

    private async formatActive(): Promise<void> {
        // In the real Obsidian plugin, get the active file via workspace.getActiveFile().
        // This is a placeholder; full implementation requires the Obsidian runtime API.
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

    private lineBoundaryWrap(_editor: Editor, _line: number, ch: number, marker: string): string {
        const atLineStart = ch === 0;
        const prefix = atLineStart ? '' : '\n';
        const suffix = '\n';
        return `${prefix}${marker}${suffix}`;
    }

    private isMarkdownActive(): boolean {
        const active = this.app.workspace?.getActiveFile();
        return active?.extension === 'md';
    }

    private async initWorkspace(): Promise<void> {
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
        const clipboard = globalThis.navigator?.clipboard;
        if (clipboard?.writeText) {
            await clipboard.writeText(snippet);
            return;
        }
        // Fallback when clipboard API is unavailable in runtime/tests.
        console.log(snippet);
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
