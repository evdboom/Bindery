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
    adapter?: { basePath: string; [key: string]: unknown };
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

/**
 * Minimal stub for the Obsidian Plugin base class.
 *
 * The real implementation is injected by the Obsidian runtime. This class
 * provides enough structure for TypeScript compilation and unit testing.
 * `BinderyPlugin` extends this class, matching the standard Obsidian plugin shape.
 */
export class Plugin {
    app!: App;

    constructor(app: App) { this.app = app; }

    loadData(): Promise<unknown> { return Promise.resolve(null); }
    saveData(_data: unknown): Promise<void> { return Promise.resolve(); }
    addCommand(_command: { id: string; name: string; callback: () => void | Promise<void> }): void {}
    addSettingTab(_tab: PluginSettingTab): void {}
    registerEvent(_eventRef: EventRef): void {}
}
