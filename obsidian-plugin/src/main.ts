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

import { readWorkspaceSettings, BINDERY_FOLDER, SETTINGS_FILENAME } from '@bindery/core';
import { formatFile } from './formatter';
import { exportBook } from './exporter';
import { BinderySettingsTab, DEFAULT_SETTINGS, type BinderySettings } from './settings-tab';
import type { App, Plugin, TFile, Vault } from './obsidian-types';
import * as fs   from 'node:fs';
import * as path from 'node:path';

// The real `Plugin`, `Notice`, etc. come from the Obsidian runtime.
// We re-declare the minimal class shape here so TypeScript accepts it
// without the npm `obsidian` package installed.

export default class BinderyPlugin {
    app: App;
    settings: BinderySettings = { ...DEFAULT_SETTINGS };
    private plugin: Plugin;

    constructor(app: App, plugin: Plugin) {
        this.app = app;
        this.plugin = plugin;
    }

    async onload(): Promise<void> {
        await this.loadSettings();

        // Format on save
        this.plugin.registerEvent(
            this.app.vault.on('modify', (...args: unknown[]) => {
                const file = args[0] as TFile;
                if (this.settings.formatOnSave && file.extension === 'md') {
                    void this.formatFile(file);
                }
            }),
        );

        // Command: format active document
        this.plugin.addCommand({
            id:       'format-document',
            name:     'Bindery: Format document',
            callback: () => void this.formatActive(),
        });

        // Export commands
        for (const fmt of ['md', 'docx', 'epub', 'pdf'] as const) {
            const label = fmt.toUpperCase();
            this.plugin.addCommand({
                id:       `export-${fmt}`,
                name:     `Bindery: Export → ${label}`,
                callback: () => void exportBook(this.app, this.settings, fmt),
            });
        }

        // Init workspace
        this.plugin.addCommand({
            id:       'init-workspace',
            name:     'Bindery: Initialize workspace',
            callback: () => void this.initWorkspace(),
        });

        // Show MCP config snippet
        this.plugin.addCommand({
            id:       'show-mcp-config',
            name:     'Bindery: Show MCP config snippet',
            callback: () => { this.showMcpSnippet(); },
        });

        this.plugin.addSettingTab(new BinderySettingsTab(this.app, {
            ...this.plugin,
            settings: this.settings,
            saveSettings: () => this.saveSettings(),
        }));
    }

    private async formatFile(file: TFile): Promise<void> {
        await formatFile(this.app.vault, file);
    }

    private async formatActive(): Promise<void> {
        // In the real Obsidian plugin, get the active file via workspace.getActiveFile().
        // This is a placeholder; full implementation requires the Obsidian runtime API.
    }

    private async initWorkspace(): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const vaultPath = (this.app.vault.adapter as any).basePath as string;
        const binderyFolder = path.join(vaultPath, BINDERY_FOLDER);
        const settingsPath  = path.join(binderyFolder, SETTINGS_FILENAME);

        if (fs.existsSync(settingsPath)) {
            return; // already initialised
        }

        fs.mkdirSync(binderyFolder, { recursive: true });
        const vaultName = this.app.vault.getName();
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

    showMcpSnippet(): string {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const vaultPath = (this.app.vault.adapter as any).basePath as string;
        const bookName  = this.app.vault.getName();
        const snippet   = JSON.stringify({
            mcpServers: {
                bindery: {
                    command: 'node',
                    args: [
                        '/path/to/bindery-mcp/out/index.js',
                        '--book',
                        `${bookName}=${vaultPath}`,
                    ],
                },
            },
        }, null, 2);
        return snippet;
    }

    async loadSettings(): Promise<void> {
        const loaded = await this.plugin.loadData() as Partial<BinderySettings> | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
    }

    async saveSettings(): Promise<void> {
        await this.plugin.saveData(this.settings);
    }
}

// Re-export for consumers (e.g. settings tab, tests)
export { readWorkspaceSettings };
