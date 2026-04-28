import { describe, it, expect, vi, beforeEach } from 'vitest';
import BinderyPlugin from '../src/main';
import type { App, Vault } from '../src/obsidian-types';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeApp(vaultPath: string, vaultName = 'TestVault'): App {
    const vault: Vault = {
        read:    vi.fn().mockResolvedValue(''),
        modify:  vi.fn().mockResolvedValue(undefined),
        getName: () => vaultName,
        on:      vi.fn().mockReturnValue({}),
        adapter: { basePath: vaultPath },
    } as unknown as Vault;
    return { vault };
}

// ─── showMcpSnippet ───────────────────────────────────────────────────────────

describe('showMcpSnippet', () => {
    it('returns valid JSON containing the vault path and name', () => {
        const app = makeApp('/my/vault', 'MyBook');
        const bp = new BinderyPlugin(app);

        const snippet = bp.showMcpSnippet();
        const parsed = JSON.parse(snippet) as { mcpServers: { bindery: { args: string[] } } };

        expect(parsed.mcpServers.bindery.args).toContain('MyBook=/my/vault');
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
        const app = makeApp('/my/vault', 'MyVault');
        const bp = new BinderyPlugin(app);
        bp.settings.bookRoot = 'MyNovel';

        const snippet = bp.showMcpSnippet();
        const parsed = JSON.parse(snippet) as { mcpServers: { bindery: { args: string[] } } };

        // Should use folder name "MyNovel", not vault name "MyVault"
        const bookArg = parsed.mcpServers.bindery.args.find((a: string) => a.includes('='));
        expect(bookArg).toContain('MyNovel=');
        expect(bookArg).toContain(path.join('/my/vault', 'MyNovel'));
        expect(bookArg).not.toContain('MyVault=');
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
        let savedCallback: ((...args: unknown[]) => void) | undefined;
        vi.spyOn(app.vault, 'on').mockImplementation((_event, cb) => {
            savedCallback = cb as (...args: unknown[]) => void;
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

        let savedCallback: ((...args: unknown[]) => void) | undefined;
        vi.spyOn(app.vault, 'on').mockImplementation((_event, cb) => {
            savedCallback = cb as (...args: unknown[]) => void;
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
