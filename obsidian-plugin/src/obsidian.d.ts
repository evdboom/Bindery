declare module 'obsidian' {
    export interface EditorPosition {
        line: number;
        ch: number;
    }

    export interface Editor {
        getCursor(which?: 'from' | 'to' | 'head' | 'anchor'): EditorPosition;
        getLine(line: number): string;
        getSelection(): string;
        replaceSelection(text: string): void;
        replaceRange(text: string, from: EditorPosition, to?: EditorPosition): void;
    }

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
        workspace?: {
            getActiveFile(): TFile | null;
            on(event: string, callback: (...args: unknown[]) => unknown): EventRef;
        };
    }

    export class Notice {
        constructor(message: string, timeout?: number);
    }

    export interface Command {
        id: string;
        name: string;
        callback?: () => void | Promise<void>;
        editorCallback?: (editor: Editor) => void;
    }

    export class Plugin {
        app: App;
        constructor(app: App);
        loadData(): Promise<unknown>;
        saveData(data: unknown): Promise<void>;
        addRibbonIcon(icon: string, title: string, callback: () => void): HTMLElement;
        addCommand(command: Command): void;
        addSettingTab(tab: unknown): void;
        registerEvent(eventRef: EventRef): void;
    }
}
