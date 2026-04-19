import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSemanticIndex } from '../src/search';

const tempRoots: string[] = [];

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-semantic-batch-'));
    tempRoots.push(root);
    return root;
}

function write(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
}

beforeEach(() => {
    process.env['BINDERY_OLLAMA_URL'] = 'http://localhost:11434';
    process.env['BINDERY_ENABLE_SEMANTIC_INDEX'] = 'true';
});

afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['BINDERY_OLLAMA_URL'];
    delete process.env['BINDERY_OLLAMA_CONCURRENCY'];
    delete process.env['BINDERY_ENABLE_SEMANTIC_INDEX'];
    for (const root of tempRoots.splice(0, tempRoots.length)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function vectorFetchMock() {
    let inflight = 0;
    let peak = 0;
    const fn = vi.fn().mockImplementation(async (input: unknown) => {
        const url = String(input);
        if (url.endsWith('/api/tags')) {
            return { ok: true, json: async () => ({ models: [{ name: 'nomic-embed-text' }] }) };
        }
        inflight++;
        peak = Math.max(peak, inflight);
        // yield so the microtask queue can schedule other workers
        await new Promise(r => setTimeout(r, 5));
        inflight--;
        return { ok: true, json: async () => ({ embedding: [0.1, 0.2, 0.3] }) };
    });
    return { fn, peakInflight: () => peak };
}

describe('buildSemanticIndex — batching and progress', () => {
    it('invokes onProgress once per chunk with monotonically increasing counts', async () => {
        const root = makeRoot();
        for (let i = 1; i <= 4; i++) {
            write(path.join(root, 'Story', 'EN', 'Act I', `Chapter ${i}.md`), `# Ch${i}\nContent for chapter ${i}.\n`);
        }

        const mock = vectorFetchMock();
        vi.stubGlobal('fetch', mock.fn);

        const events: Array<{ completed: number; total: number; failed: number }> = [];
        const result = await buildSemanticIndex(root, { onProgress: (p) => events.push({ ...p }) });

        expect(result.meta.chunkCount).toBeGreaterThan(0);
        expect(events.length).toBe(result.meta.chunkCount);
        for (let i = 0; i < events.length; i++) {
            expect(events[i].completed).toBe(i + 1);
            expect(events[i].total).toBe(result.meta.chunkCount);
        }
    });

    it('respects BINDERY_OLLAMA_CONCURRENCY as an upper bound on in-flight requests', async () => {
        const root = makeRoot();
        for (let i = 1; i <= 8; i++) {
            write(path.join(root, 'Story', 'EN', 'Act I', `Chapter ${i}.md`), `# Ch${i}\nContent ${i}.\n`);
        }

        process.env['BINDERY_OLLAMA_CONCURRENCY'] = '2';

        const mock = vectorFetchMock();
        vi.stubGlobal('fetch', mock.fn);

        await buildSemanticIndex(root);
        // Allow some slack: peak should not exceed 2 by more than the /api/tags preflight
        expect(mock.peakInflight()).toBeLessThanOrEqual(2);
    });

    it('tracks failed embeddings without aborting the build', async () => {
        const root = makeRoot();
        for (let i = 1; i <= 3; i++) {
            write(path.join(root, 'Story', 'EN', 'Act I', `Chapter ${i}.md`), `# Ch${i}\nContent ${i}.\n`);
        }

        let call = 0;
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: unknown) => {
            const url = String(input);
            if (url.endsWith('/api/tags')) {
                return { ok: true, json: async () => ({ models: [{ name: 'nomic-embed-text' }] }) };
            }
            call++;
            if (call === 2) { return { ok: false, json: async () => ({}) }; }
            return { ok: true, json: async () => ({ embedding: [0.1, 0.2] }) };
        }));

        const events: Array<{ completed: number; total: number; failed: number }> = [];
        const result = await buildSemanticIndex(root, { onProgress: (p) => events.push({ ...p }) });

        expect(result.meta.vectorCount).toBeLessThan(result.meta.chunkCount);
        expect(events.at(-1)?.failed).toBeGreaterThanOrEqual(1);
    });
});
