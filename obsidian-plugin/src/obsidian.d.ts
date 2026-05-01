declare module 'obsidian' {
    export interface EventRef {
        [key: string]: unknown;
    }

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
        adapter?: { basePath: string; [key: string]: unknown };
    }

    export interface App {
        vault: Vault;
    }

    export class Plugin {
        app: App;
        constructor(app: App);
        loadData(): Promise<unknown>;
        saveData(data: unknown): Promise<void>;
        addCommand(command: { id: string; name: string; callback: () => void | Promise<void> }): void;
        addSettingTab(tab: unknown): void;
        registerEvent(eventRef: EventRef): void;
    }
}
