import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs   from 'node:fs';
import * as os   from 'node:os';
import * as path from 'node:path';
import { buildPandocArgs, resolveToolPath, resolvePandocPath, resolveLibreOfficePath, resolveBookRoot, exportBook } from '../src/exporter';
import type { App, Vault } from '../src/obsidian-types';
import type { BinderySettings } from '../src/settings-tab';

// ─── resolveToolPath ──────────────────────────────────────────────────────────

describe('resolveToolPath', () => {
    it('returns the default command when override equals the default', () => {
        const result = resolveToolPath('pandoc', 'pandoc', []);
        expect(result).toBe('pandoc');
    });

    it('returns the default command when override is empty', () => {
        const result = resolveToolPath('', 'pandoc', []);
        expect(result).toBe('pandoc');
    });

    it('returns the default command when no well-known paths exist', () => {
        // All well-known paths point at non-existent paths
        const result = resolveToolPath('pandoc', 'pandoc', ['/nonexistent/path/pandoc']);
        expect(result).toBe('pandoc');
    });

    it('returns override path when it exists and differs from default', () => {
        // Create a temp file to act as an "existing" override
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-resolvetool-'));
        const fakeBin = path.join(tmp, 'mypandoc');
        fs.writeFileSync(fakeBin, '#!/bin/sh\necho hi', 'utf-8');

        const result = resolveToolPath(fakeBin, 'pandoc', []);
        fs.rmSync(tmp, { recursive: true, force: true });
        expect(result).toBe(fakeBin);
    });

    it('returns first well-known path that exists', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-resolvetool-'));
        const fakeBin = path.join(tmp, 'pandoc');
        fs.writeFileSync(fakeBin, '#!/bin/sh\necho hi', 'utf-8');

        const result = resolveToolPath('pandoc', 'pandoc', ['/no/such/path', fakeBin]);
        fs.rmSync(tmp, { recursive: true, force: true });
        expect(result).toBe(fakeBin);
    });

    it('returns non-path command override as-is', () => {
        const result = resolveToolPath('soffice', 'libreoffice', []);
        expect(result).toBe('soffice');
    });
});

// ─── resolvePandocPath / resolveLibreOfficePath ───────────────────────────────

describe('resolvePandocPath', () => {
    it('returns a path that refers to pandoc when settings override equals default', () => {
        const settings: BinderySettings = {
            pandocPath: 'pandoc', libreOfficePath: 'libreoffice',
            formatOnSave: false, defaultFormat: 'docx',
            bookRoot: '',
        };
        // May return 'pandoc' (fallback) or an absolute path if pandoc is installed;
        // either way it must reference pandoc.
        expect(resolvePandocPath(settings)).toMatch(/pandoc/i);
    });
});

describe('resolveLibreOfficePath', () => {
    it('returns a path that refers to libreoffice or soffice when settings override equals default', () => {
        const settings: BinderySettings = {
            pandocPath: 'pandoc', libreOfficePath: 'libreoffice',
            formatOnSave: false, defaultFormat: 'docx',
            bookRoot: '',
        };
        expect(resolveLibreOfficePath(settings)).toMatch(/libreoffice|soffice/i);
    });
});

// ─── buildPandocArgs ──────────────────────────────────────────────────────────

describe('buildPandocArgs', () => {
    it('builds basic docx args', () => {
        const args = buildPandocArgs('in.md', 'out.docx', 'docx');
        expect(args).toContain('in.md');
        expect(args).toContain('-o');
        expect(args).toContain('out.docx');
        expect(args).toContain('--to=docx');
        expect(args).toContain('--standalone');
    });

    it('builds epub args', () => {
        const args = buildPandocArgs('in.md', 'out.epub', 'epub');
        expect(args).toContain('--to=epub');
    });

    it('includes title metadata when provided', () => {
        const args = buildPandocArgs('in.md', 'out.docx', 'docx', 'My Book');
        expect(args.some(a => a.includes('title'))).toBe(true);
    });

    it('includes author metadata when provided', () => {
        const args = buildPandocArgs('in.md', 'out.docx', 'docx', undefined, 'Alice');
        expect(args.some(a => a.includes('author'))).toBe(true);
    });

    it('omits title/author metadata when not provided', () => {
        const args = buildPandocArgs('in.md', 'out.docx', 'docx');
        expect(args.some(a => a.includes('title'))).toBe(false);
        expect(args.some(a => a.includes('author'))).toBe(false);
    });

    it('builds md (markdown passthrough) args without --to flag', () => {
        const args = buildPandocArgs('in.md', 'out.md', 'md');
        // no --to= for markdown
        expect(args.some(a => a.startsWith('--to='))).toBe(false);
    });
});

// ─── exportBook ──────────────────────────────────────────────────────────────

vi.mock('node:child_process', () => ({
    execFile: vi.fn((_cmd: string, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) => {
        cb(null, '', '');
    }),
}));

function makeApp(vaultPath: string): App {
    const vault: Vault = {
        read:    vi.fn().mockResolvedValue(''),
        modify:  vi.fn().mockResolvedValue(undefined),
        getName: () => 'TestVault',
        on:      vi.fn().mockReturnValue({}),
        adapter: { basePath: vaultPath },
    } as unknown as Vault;
    return { vault };
}

const DEFAULT_SETTINGS: BinderySettings = {
    pandocPath: 'pandoc', libreOfficePath: 'libreoffice',
    formatOnSave: false, defaultFormat: 'docx',
    bookRoot: '',
};

// ─── resolveBookRoot ───────────────────────────────────────────────────────

describe('resolveBookRoot', () => {
    it('returns vaultPath unchanged when bookRoot is empty', () => {
        const vaultPath = path.resolve('/vault');
        expect(resolveBookRoot(vaultPath, '')).toBe(vaultPath);
    });

    it('returns vaultPath unchanged when bookRoot is whitespace', () => {
        const vaultPath = path.resolve('/vault');
        expect(resolveBookRoot(vaultPath, '  ')).toBe(vaultPath);
    });

    it('joins vaultPath with bookRoot when set', () => {
        const vaultPath = path.resolve('/vault');
        const result = resolveBookRoot(vaultPath, 'MyNovel');
        expect(result).toBe(path.join(vaultPath, 'MyNovel'));
    });

    it('handles nested bookRoot paths', () => {
        const vaultPath = path.resolve('/vault');
        const result = resolveBookRoot(vaultPath, 'Books/Novel1');
        expect(result).toBe(path.join(vaultPath, 'Books', 'Novel1'));
    });

    it('trims whitespace from bookRoot', () => {
        const vaultPath = path.resolve('/vault');
        const result = resolveBookRoot(vaultPath, '  MyNovel  ');
        expect(result).toBe(path.join(vaultPath, 'MyNovel'));
    });

    it('throws when bookRoot escapes the vault', () => {
        const vaultPath = path.resolve('/vault');
        expect(() => resolveBookRoot(vaultPath, '../outside')).toThrow(/must stay inside the vault/);
    });
});

describe('exportBook', () => {
    let tmpRoot: string;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-export-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('throws when merged markdown input does not exist', async () => {
        const app = makeApp(tmpRoot);
        await expect(exportBook(app, DEFAULT_SETTINGS, 'docx')).rejects.toThrow('Merged markdown not found');
    });

    it('throws when vault basePath is missing', async () => {
        const app = makeApp(tmpRoot);
        app.vault.adapter = undefined;
        await expect(exportBook(app, DEFAULT_SETTINGS, 'docx')).rejects.toThrow(/basePath is unavailable/);
    });

    it('calls pandoc with correct args for docx export', async () => {
        const { execFile } = await import('node:child_process');
        const execMock = vi.mocked(execFile);
        execMock.mockClear();

        const outputDir = path.join(tmpRoot, 'Merged');
        fs.mkdirSync(outputDir, { recursive: true });
        const inputFile = path.join(outputDir, 'Book_Merged.md');
        fs.writeFileSync(inputFile, '# Chapter', 'utf-8');

        const app = makeApp(tmpRoot);
        await exportBook(app, DEFAULT_SETTINGS, 'docx');

        expect(execMock).toHaveBeenCalledOnce();
        const [cmd, args] = execMock.mock.calls[0] as [string, string[], unknown];
        // Tool path may be an absolute path on systems where pandoc is installed
        expect(cmd).toMatch(/pandoc/i);
        expect(args).toContain('--to=docx');
    });

    it('calls pandoc with correct args for epub export', async () => {
        const { execFile } = await import('node:child_process');
        const execMock = vi.mocked(execFile);
        execMock.mockClear();

        const outputDir = path.join(tmpRoot, 'Merged');
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(path.join(outputDir, 'Book_Merged.md'), '# Chapter', 'utf-8');

        const app = makeApp(tmpRoot);
        await exportBook(app, DEFAULT_SETTINGS, 'epub');

        const [, args] = execMock.mock.calls[0] as [string, string[], unknown];
        expect(args).toContain('--to=epub');
    });

    it('does not invoke pandoc for markdown export', async () => {
        const { execFile } = await import('node:child_process');
        const execMock = vi.mocked(execFile);
        execMock.mockClear();

        const outputDir = path.join(tmpRoot, 'Merged');
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(path.join(outputDir, 'Book_Merged.md'), '# Chapter', 'utf-8');

        const app = makeApp(tmpRoot);
        await exportBook(app, DEFAULT_SETTINGS, 'md');

        expect(execMock).not.toHaveBeenCalled();
    });

    it('calls pandoc then libreoffice for pdf export', async () => {
        const { execFile } = await import('node:child_process');
        const execMock = vi.mocked(execFile);
        execMock.mockClear();

        const outputDir = path.join(tmpRoot, 'Merged');
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(path.join(outputDir, 'Book_Merged.md'), '# Chapter', 'utf-8');

        const app = makeApp(tmpRoot);
        await exportBook(app, DEFAULT_SETTINGS, 'pdf');

        // Two calls: pandoc (docx) then libreoffice (pdf)
        expect(execMock).toHaveBeenCalledTimes(2);
        const [cmd1] = execMock.mock.calls[0] as [string, string[], unknown];
        const [cmd2] = execMock.mock.calls[1] as [string, string[], unknown];
        expect(cmd1).toMatch(/pandoc/i);
        expect(cmd2).toMatch(/libreoffice|soffice/i);
    });

    it('skips pandoc for pdf when docx already exists', async () => {
        const { execFile } = await import('node:child_process');
        const execMock = vi.mocked(execFile);
        execMock.mockClear();

        const outputDir = path.join(tmpRoot, 'Merged');
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(path.join(outputDir, 'Book_Merged.md'),   '# Chapter', 'utf-8');
        fs.writeFileSync(path.join(outputDir, 'Book_Merged.docx'), 'docx stub', 'utf-8');

        const app = makeApp(tmpRoot);
        await exportBook(app, DEFAULT_SETTINGS, 'pdf');

        // Only libreoffice called (docx already present)
        expect(execMock).toHaveBeenCalledOnce();
        const [cmd] = execMock.mock.calls[0] as [string, string[], unknown];
        expect(cmd).toMatch(/libreoffice|soffice/i);
    });

    it('rejects when execFile reports an error', async () => {
        const { execFile } = await import('node:child_process');
        const execMock = vi.mocked(execFile);
        execMock.mockImplementationOnce((_cmd, _args, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
            cb(new Error('not found'), '', 'command not found');
            return undefined as unknown as ReturnType<typeof execFile>;
        });

        const outputDir = path.join(tmpRoot, 'Merged');
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(path.join(outputDir, 'Book_Merged.md'), '# Chapter', 'utf-8');

        const app = makeApp(tmpRoot);
        // Error message includes the resolved tool path (may be absolute on systems with pandoc)
        await expect(exportBook(app, DEFAULT_SETTINGS, 'docx')).rejects.toThrow('command not found');
    });

    it('reads title and author from workspace settings when present', async () => {
        const { execFile } = await import('node:child_process');
        const execMock = vi.mocked(execFile);
        execMock.mockClear();

        // Write .bindery/settings.json with title + author
        const binderyDir = path.join(tmpRoot, '.bindery');
        fs.mkdirSync(binderyDir, { recursive: true });
        fs.writeFileSync(
            path.join(binderyDir, 'settings.json'),
            JSON.stringify({ bookTitle: 'My Novel', author: 'Jane Doe' }),
            'utf-8',
        );

        const outputDir = path.join(tmpRoot, 'Merged');
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(path.join(outputDir, 'Book_Merged.md'), '# Chapter', 'utf-8');

        const app = makeApp(tmpRoot);
        await exportBook(app, DEFAULT_SETTINGS, 'docx');

        const [, args] = execMock.mock.calls[0] as [string, string[], unknown];
        expect(args.some((a: string) => a.includes('My Novel'))).toBe(true);
        expect(args.some((a: string) => a.includes('Jane Doe'))).toBe(true);
    });

    it('reads settings and output from bookRoot subfolder when bookRoot is set', async () => {
        const { execFile } = await import('node:child_process');
        const execMock = vi.mocked(execFile);
        execMock.mockClear();

        // Create book in a subfolder of the vault
        const bookDir = path.join(tmpRoot, 'MyNovel');
        const binderyDir = path.join(bookDir, '.bindery');
        fs.mkdirSync(binderyDir, { recursive: true });
        fs.writeFileSync(
            path.join(binderyDir, 'settings.json'),
            JSON.stringify({ bookTitle: 'My Novel', author: 'Jane Doe' }),
            'utf-8',
        );

        const outputDir = path.join(bookDir, 'Merged');
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(path.join(outputDir, 'Book_Merged.md'), '# Chapter', 'utf-8');

        const app = makeApp(tmpRoot);
        const settings: BinderySettings = { ...DEFAULT_SETTINGS, bookRoot: 'MyNovel' };
        await exportBook(app, settings, 'docx');

        const [, args] = execMock.mock.calls[0] as [string, string[], unknown];
        // Output file should be inside the bookRoot subfolder
        expect(args.some((a: string) => a.includes('MyNovel'))).toBe(true);
        expect(args.some((a: string) => a.includes('My Novel'))).toBe(true);
    });
});
