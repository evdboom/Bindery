import { applyTypography } from '@bindery/core';
import type { App, Plugin, PluginSettingTab } from './obsidian-types';

export type ExportFormat = 'md' | 'docx' | 'epub' | 'pdf';

export interface BinderySettings {
    pandocPath:       string;
    libreOfficePath:  string;
    formatOnSave:     boolean;
    defaultFormat:    ExportFormat;
}

export const DEFAULT_SETTINGS: BinderySettings = {
    pandocPath:      'pandoc',
    libreOfficePath: 'libreoffice',
    formatOnSave:    false,
    defaultFormat:   'docx',
};

/**
 * Settings tab for the Bindery Obsidian plugin.
 *
 * Rendered inside Obsidian's Settings → Community plugins → Bindery.
 * Provides UI to configure Pandoc path, LibreOffice path, format-on-save,
 * and default export format.
 *
 * Note: this class uses the Obsidian API which is only available at runtime.
 * The class is not unit-testable directly; its rendering is exercised manually.
 */
export class BinderySettingsTab {
    app: App;
    plugin: Plugin & { settings: BinderySettings; saveSettings: () => Promise<void> };

    constructor(app: App, plugin: Plugin & { settings: BinderySettings; saveSettings: () => Promise<void> }) {
        this.app = app;
        this.plugin = plugin;
    }

    display(): void {
        // Settings tab rendering uses the Obsidian API (containerEl, Setting class).
        // The real implementation depends on the runtime obsidian module.
        // This method is intentionally left as a thin shell; real UI code is added
        // when the plugin is built against the full Obsidian API.
    }

    hide(): void {
        // No-op stub; the real Obsidian API calls this when the tab loses focus.
    }
}

export { applyTypography };
