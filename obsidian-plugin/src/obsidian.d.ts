declare module 'obsidian' {
    export interface EditorPosition {
        line: number;
        ch: number;
    }

    export interface Editor {
        getCursor(_which?: 'from' | 'to' | 'head' | 'anchor'): EditorPosition;
        getLine(_line: number): string;
        getSelection(): string;
        replaceSelection(_text: string): void;
        replaceRange(_text: string, _from: EditorPosition, _to?: EditorPosition): void;
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
        read(_file: TFile): Promise<string>;
        modify(_file: TFile, _data: string): Promise<void>;
        getName(): string;
        on(_event: string, _callback: (..._args: unknown[]) => unknown): EventRef;
        adapter?: { basePath: string; [key: string]: unknown };
    }

    export interface App {
        vault: Vault;
        workspace?: {
            getActiveFile(): TFile | null;
            on(_event: string, _callback: (..._args: unknown[]) => unknown): EventRef;
        };
    }

    export class Notice {
        constructor(_message: string, _timeout?: number);
    }

    export interface Command {
        id: string;
        name: string;
        callback?: () => void | Promise<void>;
        editorCallback?: (_editor: Editor) => void;
    }

    export class Plugin {
        app: App;
        constructor(_app: App);
        loadData(): Promise<unknown>;
        saveData(_data: unknown): Promise<void>;
        addRibbonIcon(_icon: string, _title: string, _callback: () => void): HTMLElement;
        addCommand(_command: Command): void;
        addSettingTab(_tab: unknown): void;
        registerEvent(_eventRef: EventRef): void;
    }
}
