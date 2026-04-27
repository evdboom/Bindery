/**
 * Minimal Obsidian API type stubs.
 *
 * The real `obsidian` module is injected by the Obsidian desktop app at runtime.
 * These stubs allow the plugin to compile and be tested without the full API.
 */

export interface TFile {
    path: string;
    extension: string;
    name: string;
    basename: string;
}

export interface Vault {
    read(file: TFile): Promise<string>;
    modify(file: TFile, data: string): Promise<void>;
    getName(): string;
    on(event: string, callback: (...args: unknown[]) => unknown): EventRef;
    /** Obsidian file system adapter — only present on desktop builds. */
    adapter: { basePath: string; [key: string]: unknown };
}

export interface EventRef {
    [key: string]: unknown;
}

export interface App {
    vault: Vault;
}

export interface Modal {
    open(): void;
    close(): void;
}

export interface Notice {
    new (message: string): void;
}

export interface PluginSettingTab {
    app: App;
    plugin: Plugin;
    display(): void;
    hide(): void;
}

export interface Plugin {
    app: App;
    loadData(): Promise<unknown>;
    saveData(data: unknown): Promise<void>;
    addCommand(command: { id: string; name: string; callback: () => void | Promise<void> }): void;
    addSettingTab(tab: PluginSettingTab): void;
    registerEvent(eventRef: EventRef): void;
}
