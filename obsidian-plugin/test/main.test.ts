/// <reference types="node" />
/// <reference path="../src/obsidian.d.ts" />

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

// ─── Mock obsidian ────────────────────────────────────────────────────────────
// Must be declared before any imports that pull in obsidian transitively.

vi.mock('obsidian', () => {
    class Notice {
        message: string;
        timeout?: number;

        constructor(message: string, timeout?: number) {
            this.message = message;
            this.timeout = timeout;
        }
    }

    class Plugin {
        app: App;

        constructor(app: App) {
            this.app = app;
        }

        loadData(): Promise<unknown> {
            return Promise.resolve(null);
        }

        saveData(_data: unknown): Promise<void> {
            return Promise.resolve();
        }

        addCommand(_command: {
            id: string;
            name: string;
            callback?: () => void | Promise<void>;
            editorCallback?: (_editor: unknown) => void;
        }): void { return; }

        addRibbonIcon(_icon: string, _title: string, _callback: () => void): HTMLElement {
            return {} as HTMLElement;
        }

        addSettingTab(_tab: unknown): void { return; }

        registerEvent(_eventRef: unknown): void { return; }
    }

    return { Plugin, Notice };
});

import BinderyPlugin from '../src/main';
import type { App, Vault, Editor } from 'obsidian';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeApp(vaultPath: string, vaultName = 'TestVault'): App {
    const vault: Vault = {
        read:    vi.fn().mockResolvedValue(''),
        modify:  vi.fn().mockResolvedValue(undefined),
        getName: () => vaultName,
        on:      vi.fn().mockReturnValue({}),
        adapter: { basePath: vaultPath },
    } as unknown as Vault;
    return {
        vault,
        workspace: {
            getActiveFile: () => null,
            on: vi.fn().mockReturnValue({}),
        },
    } as unknown as App;
}

function makeEditor(lineText: string, cursorCh: number, selection = ''): Editor {
    return {
        getCursor: vi.fn((which?: 'from' | 'to' | 'head' | 'anchor') => {
            if (which === 'to') {
                return { line: 0, ch: cursorCh + selection.length };
            }
            return { line: 0, ch: cursorCh };
        }),
        getLine: vi.fn(() => lineText),
        getSelection: vi.fn(() => selection),
        replaceSelection: vi.fn(),
        replaceRange: vi.fn(),
    };
}

// ─── showMcpSnippet ───────────────────────────────────────────────────────────

describe('showMcpSnippet', () => {
    it('returns valid JSON containing the vault path and name', () => {
        const vaultPath = path.resolve('/my/vault');
        const app = makeApp(vaultPath, 'MyBook');
        const bp = new BinderyPlugin(app);

        const snippet = bp.showMcpSnippet();
        const parsed = JSON.parse(snippet) as { mcpServers: { bindery: { args: string[] } } };

        expect(parsed.mcpServers.bindery.args).toContain(`MyBook=${vaultPath}`);
    });

    it('returns a JSON string with mcpServers key', () => {
        const app = makeApp('/some/path');
        const bp = new BinderyPlugin(app);

        const snippet = bp.showMcpSnippet();
        expect(() => JSON.parse(snippet)).not.toThrow();
        const parsed = JSON.parse(snippet) as Record<string, unknown>;
        expect(parsed).toHaveProperty('mcpServers');
    });

    it('uses bookRoot folder name and resolved path when bookRoot is set', () => {
        const vaultPath = path.resolve('/my/vault');
        const app = makeApp(vaultPath, 'MyVault');
        const bp = new BinderyPlugin(app);
        bp.settings.bookRoot = 'MyNovel';

        const snippet = bp.showMcpSnippet();
        const parsed = JSON.parse(snippet) as { mcpServers: { bindery: { args: string[] } } };

        // Should use folder name "MyNovel", not vault name "MyVault"
        const bookArg = parsed.mcpServers.bindery.args.find((a: string) => a.includes('='));
        expect(bookArg).toContain('MyNovel=');
        expect(bookArg).toContain(path.join(vaultPath, 'MyNovel'));
        expect(bookArg).not.toContain('MyVault=');
    });

    it('throws when vault adapter basePath is unavailable', () => {
        const app = makeApp('/some/path');
        const bp = new BinderyPlugin(app);
        app.vault.adapter = undefined;

        expect(() => bp.showMcpSnippet()).toThrow(/basePath is unavailable/);
    });
});

// ─── initWorkspace ────────────────────────────────────────────────────────────

describe('initWorkspace (via onload side-effect)', () => {
    let tmpRoot: string;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-obs-test-'));
    });

    it('creates .bindery/settings.json when it does not exist', async () => {
        const app = makeApp(tmpRoot, 'NewBook');
        const bp = new BinderyPlugin(app);

        await bp['initWorkspace']();

        const settingsPath = path.join(tmpRoot, '.bindery', 'settings.json');
        expect(fs.existsSync(settingsPath)).toBe(true);
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { bookTitle: string };
        expect(settings.bookTitle).toBe('NewBook');
    });

    it('does not overwrite existing settings.json', async () => {
        const binderyDir = path.join(tmpRoot, '.bindery');
        fs.mkdirSync(binderyDir, { recursive: true });
        const settingsPath = path.join(binderyDir, 'settings.json');
        const original = JSON.stringify({ bookTitle: 'Original', author: 'Test' });
        fs.writeFileSync(settingsPath, original, 'utf-8');

        const app = makeApp(tmpRoot, 'NewBook');
        const bp = new BinderyPlugin(app);

        await bp['initWorkspace']();

        const content = fs.readFileSync(settingsPath, 'utf-8');
        const parsed = JSON.parse(content) as { bookTitle: string; author: string };
        expect(parsed.bookTitle).toBe('Original');
        expect(parsed.author).toBe('Test');
    });

    it('creates .bindery inside bookRoot subfolder when bookRoot is set', async () => {
        const app = makeApp(tmpRoot, 'MyVault');
        const bp = new BinderyPlugin(app);
        bp.settings.bookRoot = 'MyNovel';

        await bp['initWorkspace']();

        const settingsPath = path.join(tmpRoot, 'MyNovel', '.bindery', 'settings.json');
        expect(fs.existsSync(settingsPath)).toBe(true);
        const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { bookTitle: string };
        // Title should be derived from folder name, not vault name
        expect(parsed.bookTitle).toBe('MyNovel');
    });
});

// ─── formatOnSave scoping ─────────────────────────────────────────────────────

describe('formatOnSave bookRoot scoping', () => {
    it('does not invoke formatFile for files outside bookRoot', async () => {
        const app = makeApp('/vault', 'MyVault');
        const bp = new BinderyPlugin(app);

        // Capture the vault.on callback before onload
        let savedCallback: ((..._args: unknown[]) => void) | undefined;
        vi.spyOn(app.vault, 'on').mockImplementation((_event: string, cb: (..._args: unknown[]) => unknown) => {
            savedCallback = cb as (..._args: unknown[]) => void;
            return {};
        });

        await bp.onload();
        // Set AFTER onload so loadSettings() doesn't reset them
        bp.settings.formatOnSave = true;
        bp.settings.bookRoot = 'MyNovel';

        // File outside bookRoot
        const outsideFile = { path: 'OtherFolder/chapter.md', extension: 'md', name: 'chapter.md', basename: 'chapter' };
        savedCallback?.(outsideFile);

        // vault.modify should NOT have been called (no formatting happened)
        expect(app.vault.modify).not.toHaveBeenCalled();
    });

    it('invokes formatFile for files inside bookRoot', async () => {
        const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-scope-'));
        const app = makeApp(vaultPath, 'MyVault');
        const bp = new BinderyPlugin(app);

        let savedCallback: ((..._args: unknown[]) => void) | undefined;
        vi.spyOn(app.vault, 'on').mockImplementation((_event: string, cb: (..._args: unknown[]) => unknown) => {
            savedCallback = cb as (..._args: unknown[]) => void;
            return {};
        });

        // Make vault.read return something formattable (ellipsis gets transformed)
        vi.spyOn(app.vault, 'read').mockResolvedValue('Hello world...');

        await bp.onload();
        // Set AFTER onload so loadSettings() doesn't reset them
        bp.settings.formatOnSave = true;
        bp.settings.bookRoot = 'MyNovel';

        // File inside bookRoot
        const insideFile = { path: 'MyNovel/Story/chapter.md', extension: 'md', name: 'chapter.md', basename: 'chapter' };
        savedCallback?.(insideFile);

        // Give the async formatFile call a tick to fire
        await new Promise(r => setTimeout(r, 10));

        expect(app.vault.read).toHaveBeenCalledWith(insideFile);

        fs.rmSync(vaultPath, { recursive: true, force: true });
    });
});

describe('review marker commands', () => {
    it('registers start/stop review commands', async () => {
        const app = makeApp('/vault', 'MyVault');
        app.workspace = {
            getActiveFile: () => ({ path: 'Story/ch1.md', extension: 'md', name: 'ch1.md', basename: 'ch1' }),
            on: vi.fn().mockReturnValue({}),
        };
        const bp = new BinderyPlugin(app);

        const addCommandSpy = vi.spyOn(bp, 'addCommand');
        await bp.onload();

        const commands = addCommandSpy.mock.calls.map((call) => call[0]);
        const ids = commands.map((c) => c.id);
        expect(ids).toContain('start-review-marker');
        expect(ids).toContain('stop-review-marker');
    });

    it('start-review-marker inserts review start marker at cursor', async () => {
        const app = makeApp('/vault', 'MyVault');
        app.workspace = {
            getActiveFile: () => ({ path: 'Story/ch1.md', extension: 'md', name: 'ch1.md', basename: 'ch1' }),
            on: vi.fn().mockReturnValue({}),
        };
        const bp = new BinderyPlugin(app);
        const addCommandSpy = vi.spyOn(bp, 'addCommand');
        await bp.onload();

        const commands = addCommandSpy.mock.calls.map((call) => call[0]);
        const start = commands.find((c) => c.id === 'start-review-marker');
        const editor = makeEditor('abc', 0, '');

        start?.editorCallback?.(editor);

        expect(editor.replaceRange).toHaveBeenCalledWith(
            '<!-- Bindery: Review start -->\n',
            { line: 0, ch: 0 },
        );
    });

    it('start-review-marker wraps selection with start/stop markers', async () => {
        const app = makeApp('/vault', 'MyVault');
        app.workspace = {
            getActiveFile: () => ({ path: 'Story/ch1.md', extension: 'md', name: 'ch1.md', basename: 'ch1' }),
            on: vi.fn().mockReturnValue({}),
        };
        const bp = new BinderyPlugin(app);
        const addCommandSpy = vi.spyOn(bp, 'addCommand');
        await bp.onload();

        const commands = addCommandSpy.mock.calls.map((call) => call[0]);
        const start = commands.find((c) => c.id === 'start-review-marker');
        const editor = makeEditor('abc', 0, 'X');

        start?.editorCallback?.(editor);

        expect(editor.replaceSelection).toHaveBeenCalledWith(
            '<!-- Bindery: Review start -->\nX\n<!-- Bindery: Review stop -->\n',
        );
    });

    it('stop-review-marker inserts review stop marker at cursor', async () => {
        const app = makeApp('/vault', 'MyVault');
        app.workspace = {
            getActiveFile: () => ({ path: 'Story/ch1.md', extension: 'md', name: 'ch1.md', basename: 'ch1' }),
            on: vi.fn().mockReturnValue({}),
        };
        const bp = new BinderyPlugin(app);
        const addCommandSpy = vi.spyOn(bp, 'addCommand');
        await bp.onload();

        const commands = addCommandSpy.mock.calls.map((call) => call[0]);
        const stop = commands.find((c) => c.id === 'stop-review-marker');
        const editor = makeEditor('abc', 0, '');

        stop?.editorCallback?.(editor);

        expect(editor.replaceRange).toHaveBeenCalledWith(
            '<!-- Bindery: Review stop -->\n',
            { line: 0, ch: 0 },
        );
    });

    it('start-review-marker does nothing when active file is not markdown', async () => {
        const app = makeApp('/vault', 'MyVault');
        app.workspace = {
            getActiveFile: () => ({ path: 'Story/ch1.txt', extension: 'txt', name: 'ch1.txt', basename: 'ch1' }),
            on: vi.fn().mockReturnValue({}),
        };
        const bp = new BinderyPlugin(app);
        const addCommandSpy = vi.spyOn(bp, 'addCommand');
        await bp.onload();

        const commands = addCommandSpy.mock.calls.map((call) => call[0]);
        const start = commands.find((c) => c.id === 'start-review-marker');
        const editor = makeEditor('abc', 0, '');

        start?.editorCallback?.(editor);

        expect(editor.replaceRange).not.toHaveBeenCalled();
        expect(editor.replaceSelection).not.toHaveBeenCalled();
    });

    it('stop-review-marker does nothing when active file is not markdown', async () => {
        const app = makeApp('/vault', 'MyVault');
        app.workspace = {
            getActiveFile: () => ({ path: 'Story/ch1.txt', extension: 'txt', name: 'ch1.txt', basename: 'ch1' }),
            on: vi.fn().mockReturnValue({}),
        };
        const bp = new BinderyPlugin(app);
        const addCommandSpy = vi.spyOn(bp, 'addCommand');
        await bp.onload();

        const commands = addCommandSpy.mock.calls.map((call) => call[0]);
        const stop = commands.find((c) => c.id === 'stop-review-marker');
        const editor = makeEditor('abc', 0, '');

        stop?.editorCallback?.(editor);

        expect(editor.replaceRange).not.toHaveBeenCalled();
    });

    it('stop-review-marker does not add trailing newline when cursor is at end of line', async () => {
        const app = makeApp('/vault', 'MyVault');
        app.workspace = {
            getActiveFile: () => ({ path: 'Story/ch1.md', extension: 'md', name: 'ch1.md', basename: 'ch1' }),
            on: vi.fn().mockReturnValue({}),
        };
        const bp = new BinderyPlugin(app);
        const addCommandSpy = vi.spyOn(bp, 'addCommand');
        await bp.onload();

        const commands = addCommandSpy.mock.calls.map((call) => call[0]);
        const stop = commands.find((c) => c.id === 'stop-review-marker');
        // Cursor at end of 'abc' (ch=3 === lineText.length=3)
        const editor = makeEditor('abc', 3, '');

        stop?.editorCallback?.(editor);

        expect(editor.replaceRange).toHaveBeenCalledWith(
            '\n<!-- Bindery: Review stop -->',
            { line: 0, ch: 3 },
        );
    });

    it('start-review-marker does not add trailing newline when cursor is at end of line', async () => {
        const app = makeApp('/vault', 'MyVault');
        app.workspace = {
            getActiveFile: () => ({ path: 'Story/ch1.md', extension: 'md', name: 'ch1.md', basename: 'ch1' }),
            on: vi.fn().mockReturnValue({}),
        };
        const bp = new BinderyPlugin(app);
        const addCommandSpy = vi.spyOn(bp, 'addCommand');
        await bp.onload();

        const commands = addCommandSpy.mock.calls.map((call) => call[0]);
        const start = commands.find((c) => c.id === 'start-review-marker');
        // Cursor at end of 'abc' (ch=3 === lineText.length=3)
        const editor = makeEditor('abc', 3, '');

        start?.editorCallback?.(editor);

        expect(editor.replaceRange).toHaveBeenCalledWith(
            '\n<!-- Bindery: Review start -->',
            { line: 0, ch: 3 },
        );
    });
});

describe('ribbon actions', () => {
    it('registers ribbon shortcuts for merge, format, and word scan', async () => {
        const app = makeApp('/vault', 'MyVault');
        const bp = new BinderyPlugin(app);
        const ribbonSpy = vi.spyOn(bp, 'addRibbonIcon');

        await bp.onload();

        const titles = ribbonSpy.mock.calls.map((call) => call[1]);
        expect(titles).toContain('Bindery: Merge chapters to all formats');
        expect(titles).toContain('Bindery: Format active note');
        expect(titles).toContain('Bindery: Find probable US to UK words');
    });
});

describe('context menu actions', () => {
    it('registers editor-menu and file-menu hooks', async () => {
        const app = makeApp('/vault', 'MyVault');
        const bp = new BinderyPlugin(app);

        await bp.onload();

        const workspaceOn = app.workspace?.on as ReturnType<typeof vi.fn>;
        const events = workspaceOn.mock.calls.map((c: unknown[]) => c[0]);
        expect(events).toContain('editor-menu');
        expect(events).toContain('file-menu');
    });
});
