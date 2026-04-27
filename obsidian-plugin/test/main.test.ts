import { describe, it, expect, vi, beforeEach } from 'vitest';
import BinderyPlugin from '../src/main';
import type { App, Vault, Plugin } from '../src/obsidian-types';
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

function makePlugin(): Plugin {
    return {
        app: null as unknown as App,
        loadData:       vi.fn().mockResolvedValue(null),
        saveData:       vi.fn().mockResolvedValue(undefined),
        addCommand:     vi.fn(),
        addSettingTab:  vi.fn(),
        registerEvent:  vi.fn(),
    } as unknown as Plugin;
}

// ─── showMcpSnippet ───────────────────────────────────────────────────────────

describe('showMcpSnippet', () => {
    it('returns valid JSON containing the vault path and name', () => {
        const app = makeApp('/my/vault', 'MyBook');
        const plugin = makePlugin();
        const bp = new BinderyPlugin(app, plugin);

        const snippet = bp.showMcpSnippet();
        const parsed = JSON.parse(snippet) as { mcpServers: { bindery: { args: string[] } } };

        expect(parsed.mcpServers.bindery.args).toContain('MyBook=/my/vault');
    });

    it('returns a JSON string with mcpServers key', () => {
        const app = makeApp('/some/path');
        const plugin = makePlugin();
        const bp = new BinderyPlugin(app, plugin);

        const snippet = bp.showMcpSnippet();
        expect(() => JSON.parse(snippet)).not.toThrow();
        const parsed = JSON.parse(snippet) as Record<string, unknown>;
        expect(parsed).toHaveProperty('mcpServers');
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
        const plugin = makePlugin();
        const bp = new BinderyPlugin(app, plugin);

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
        const plugin = makePlugin();
        const bp = new BinderyPlugin(app, plugin);

        await bp['initWorkspace']();

        const content = fs.readFileSync(settingsPath, 'utf-8');
        const parsed = JSON.parse(content) as { bookTitle: string; author: string };
        expect(parsed.bookTitle).toBe('Original');
        expect(parsed.author).toBe('Test');
    });
});
