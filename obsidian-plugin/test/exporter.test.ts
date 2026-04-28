import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildPandocArgs, resolveToolPath, resolvePandocPath, resolveLibreOfficePath, exportBook } from '../src/exporter';
import type { App, Vault } from '../src/obsidian-types';
import type { BinderySettings } from '../src/settings-tab';
import * as os   from 'node:os';
import * as path from 'node:path';
import * as fs   from 'node:fs';

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
});

// ─── resolvePandocPath / resolveLibreOfficePath ───────────────────────────────

describe('resolvePandocPath', () => {
    it('returns "pandoc" when settings path is the default', () => {
        const settings: BinderySettings = {
            pandocPath: 'pandoc', libreOfficePath: 'libreoffice',
            formatOnSave: false, defaultFormat: 'docx',
        };
        expect(resolvePandocPath(settings)).toBe('pandoc');
    });
});

describe('resolveLibreOfficePath', () => {
    it('returns "libreoffice" when settings path is the default', () => {
        const settings: BinderySettings = {
            pandocPath: 'pandoc', libreOfficePath: 'libreoffice',
            formatOnSave: false, defaultFormat: 'docx',
        };
        expect(resolveLibreOfficePath(settings)).toBe('libreoffice');
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
};

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
        expect(cmd).toBe('pandoc');
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
        expect(cmd1).toBe('pandoc');
        expect(cmd2).toBe('libreoffice');
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
        expect(cmd).toBe('libreoffice');
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
        await expect(exportBook(app, DEFAULT_SETTINGS, 'docx')).rejects.toThrow('pandoc failed');
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
});
