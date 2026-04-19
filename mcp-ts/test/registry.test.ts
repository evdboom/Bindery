/**
 * Tests for the book registry module (registry.ts).
 *
 * The registry reads process.argv + process.env.BINDERY_BOOKS at module load time
 * to build an immutable BOOKS map. Each test uses vi.resetModules() + dynamic import
 * to get a fresh module instance with controlled argv/env.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];
let originalArgv: string[];
let originalEnv: string | undefined;

function makeDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-registry-test-'));
    tempDirs.push(dir);
    return dir;
}

function write(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
}

beforeEach(() => {
    originalArgv = [...process.argv];
    originalEnv = process.env['BINDERY_BOOKS'];
    delete process.env['BINDERY_BOOKS'];
    vi.resetModules();
});

afterEach(() => {
    process.argv = originalArgv;
    if (originalEnv !== undefined) {
        process.env['BINDERY_BOOKS'] = originalEnv;
    } else {
        delete process.env['BINDERY_BOOKS'];
    }
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

async function importRegistry() {
    return import('../src/registry') as Promise<typeof import('../src/registry')>;
}

// ─── parseBooksFromArgs (--book flags) ───────────────────────────────────────

describe('registry — CLI --book flags', () => {
    it('parses a single --book flag', async () => {
        const dir = makeDir();
        process.argv = ['node', 'index.js', '--book', `TestBook=${dir}`];

        const { listBooks, resolveBook } = await importRegistry();
        expect(listBooks()).toEqual([{ name: 'TestBook', path: path.resolve(dir) }]);
        expect(resolveBook('TestBook').root).toBe(path.resolve(dir));
    });

    it('parses multiple --book flags', async () => {
        const dir1 = makeDir();
        const dir2 = makeDir();
        process.argv = ['node', 'index.js', '--book', `A=${dir1}`, '--book', `B=${dir2}`];

        const { listBooks } = await importRegistry();
        const books = listBooks();
        expect(books).toHaveLength(2);
        expect(books.find(b => b.name === 'A')?.path).toBe(path.resolve(dir1));
        expect(books.find(b => b.name === 'B')?.path).toBe(path.resolve(dir2));
    });

    it('ignores --book without a following argument', async () => {
        process.argv = ['node', 'index.js', '--book'];

        const { listBooks } = await importRegistry();
        expect(listBooks()).toEqual([]);
    });

    it('ignores malformed entries (no equals sign)', async () => {
        process.argv = ['node', 'index.js', '--book', 'noequalssign'];

        const { listBooks } = await importRegistry();
        expect(listBooks()).toEqual([]);
    });

    it('ignores entries with empty name', async () => {
        const dir = makeDir();
        process.argv = ['node', 'index.js', '--book', `=${dir}`];

        const { listBooks } = await importRegistry();
        expect(listBooks()).toEqual([]);
    });
});

// ─── parseBooksFromArgs (BINDERY_BOOKS env var) ───────────────────────────────

describe('registry — BINDERY_BOOKS env var', () => {
    it('parses semicolon-separated entries from env var', async () => {
        const dir1 = makeDir();
        const dir2 = makeDir();
        process.env['BINDERY_BOOKS'] = `Book1=${dir1};Book2=${dir2}`;
        process.argv = ['node', 'index.js'];

        const { listBooks } = await importRegistry();
        const books = listBooks();
        expect(books).toHaveLength(2);
        expect(books.find(b => b.name === 'Book1')).toBeDefined();
        expect(books.find(b => b.name === 'Book2')).toBeDefined();
    });

    it('skips empty segments between semicolons', async () => {
        const dir = makeDir();
        process.env['BINDERY_BOOKS'] = `;MyBook=${dir};;`;
        process.argv = ['node', 'index.js'];

        const { listBooks } = await importRegistry();
        expect(listBooks()).toHaveLength(1);
    });

    it('CLI --book and BINDERY_BOOKS combine', async () => {
        const dir1 = makeDir();
        const dir2 = makeDir();
        process.argv = ['node', 'index.js', '--book', `CliBook=${dir1}`];
        process.env['BINDERY_BOOKS'] = `EnvBook=${dir2}`;

        const { listBooks } = await importRegistry();
        const names = listBooks().map(b => b.name).sort();
        expect(names).toEqual(['CliBook', 'EnvBook']);
    });
});

// ─── resolveBook ──────────────────────────────────────────────────────────────

describe('resolveBook', () => {
    it('throws with available names when book is unknown', async () => {
        const dir = makeDir();
        process.argv = ['node', 'index.js', '--book', `Known=${dir}`];

        const { resolveBook } = await importRegistry();
        expect(() => resolveBook('Unknown')).toThrow(/Unknown book "Unknown"/);
        expect(() => resolveBook('Unknown')).toThrow(/Available: Known/);
    });

    it('throws a "no books configured" message when registry is empty', async () => {
        process.argv = ['node', 'index.js'];

        const { resolveBook } = await importRegistry();
        expect(() => resolveBook('Anything')).toThrow(/No books configured/);
    });

    it('returns name and resolved root for a valid book', async () => {
        const dir = makeDir();
        process.argv = ['node', 'index.js', '--book', `MyNovel=${dir}`];

        const { resolveBook } = await importRegistry();
        const result = resolveBook('MyNovel');
        expect(result.name).toBe('MyNovel');
        expect(result.root).toBe(path.resolve(dir));
    });
});

// ─── findBookByPath ──────────────────────────────────────────────────────────

describe('findBookByPath', () => {
    it('finds by exact path match', async () => {
        const dir = makeDir();
        process.argv = ['node', 'index.js', '--book', `Exact=${dir}`];

        const { findBookByPath } = await importRegistry();
        const result = findBookByPath(dir);
        expect(result).not.toBeNull();
        expect(result!.name).toBe('Exact');
    });

    it('finds by basename match', async () => {
        const dir = makeDir();
        const basename = path.basename(dir);
        process.argv = ['node', 'index.js', '--book', `ByBase=${dir}`];

        const { findBookByPath } = await importRegistry();
        // Create a different path with the same basename
        const altDir = path.join(os.tmpdir(), basename);
        const result = findBookByPath(altDir);
        expect(result).not.toBeNull();
        expect(result!.name).toBe('ByBase');
    });

    it('finds by .bindery/settings.json name field', async () => {
        const registeredDir = makeDir();
        const agentDir = makeDir();
        process.argv = ['node', 'index.js', '--book', `SettingsBook=${registeredDir}`];

        write(
            path.join(agentDir, '.bindery', 'settings.json'),
            JSON.stringify({ name: 'SettingsBook' })
        );

        const { findBookByPath } = await importRegistry();
        const result = findBookByPath(agentDir);
        expect(result).not.toBeNull();
        expect(result!.name).toBe('SettingsBook');
    });

    it('returns null when no match is found', async () => {
        const dir = makeDir();
        process.argv = ['node', 'index.js', '--book', `Registered=${dir}`];

        const { findBookByPath } = await importRegistry();
        const unrelated = makeDir();
        const result = findBookByPath(unrelated);
        expect(result).toBeNull();
    });

    it('ignores malformed settings.json gracefully', async () => {
        const registeredDir = makeDir();
        const agentDir = makeDir();
        process.argv = ['node', 'index.js', '--book', `Book=${registeredDir}`];

        write(path.join(agentDir, '.bindery', 'settings.json'), 'NOT JSON');

        const { findBookByPath } = await importRegistry();
        const result = findBookByPath(agentDir);
        // Should not throw, just returns null (or matches on basename/exact)
        // basename won't match since dirs are different temps, so null
        expect(result).toBeNull();
    });

    it('ignores settings.json name that does not match any registered book', async () => {
        const registeredDir = makeDir();
        const agentDir = makeDir();
        process.argv = ['node', 'index.js', '--book', `RealBook=${registeredDir}`];

        write(
            path.join(agentDir, '.bindery', 'settings.json'),
            JSON.stringify({ name: 'FakeBook' })
        );

        const { findBookByPath } = await importRegistry();
        const result = findBookByPath(agentDir);
        expect(result).toBeNull();
    });
});

// ─── listBooks ────────────────────────────────────────────────────────────────

describe('listBooks', () => {
    it('returns empty array when no books are configured', async () => {
        process.argv = ['node', 'index.js'];

        const { listBooks } = await importRegistry();
        expect(listBooks()).toEqual([]);
    });

    it('returns entries with name and absolute path', async () => {
        const dir = makeDir();
        process.argv = ['node', 'index.js', '--book', `TestBook=${dir}`];

        const { listBooks } = await importRegistry();
        const books = listBooks();
        expect(books).toHaveLength(1);
        expect(books[0].name).toBe('TestBook');
        expect(path.isAbsolute(books[0].path)).toBe(true);
    });
});
