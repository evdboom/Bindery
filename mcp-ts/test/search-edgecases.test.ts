import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    toolSearch,
    toolIndexBuild,
    toolIndexStatus,
} from '../src/tools';

const tempRoots: string[] = [];

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-mcp-XXX-test-'));
    tempRoots.push(root);
    return root;
}

function write(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
}

afterEach(() => {
    delete process.env['BINDERY_MAX_RESPONSE_BYTES'];
    delete process.env['BINDERY_EMBEDDING_MAX_CHARS'];
    for (const root of tempRoots.splice(0, tempRoots.length)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// ─── toolIndexStatus ──────────────────────────────────────────────────────────

describe('toolIndexStatus', () => {
    it('reports "No index found" before any build', () => {
        const root = makeRoot();
        const result = toolIndexStatus(root);
        expect(result).toContain('lexical: not built');
    });

    it('reports chunk count and build time after build', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Ch1\nThe silver moon rose over the mountains.\n');

        await toolIndexBuild(root);

        const result = toolIndexStatus(root);
        expect(result).toContain('lexical chunks:');
        expect(result).toContain('lexical built:');
        expect(result).toContain('semantic: not built');
    });
});

// ─── toolSearch ───────────────────────────────────────────────────────────────

describe('toolSearch', () => {
    it('auto-builds index when none exists and returns results', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Dawn\nThe crimson dragon circled the burning tower.\n');

        const result = await toolSearch(root, { query: 'crimson dragon' });
        expect(result).toContain('Chapter 1.md');
        expect(result).toContain('[1]');
    });

    it('filters results by language', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# EN\nThe silver knight rode forward.\n');
        write(path.join(root, 'Story', 'NL', 'Act I', 'Hoofdstuk 1.md'), '# NL\nDe zilveren ridder reed vooruit.\n');
        await toolIndexBuild(root);

        const result = await toolSearch(root, { query: 'silver knight', language: 'EN' });
        expect(result).toContain('EN');
        expect(result).not.toContain('NL');
    });

    it('returns "No results found." when query matches nothing', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Ch1\nThe wizard cast a spell.\n');
        await toolIndexBuild(root);

        const result = await toolSearch(root, { query: 'xyzzy quux wibble' });
        expect(result).toBe('No results found.');
    });

    it('respects maxResults limit', async () => {
        const root = makeRoot();
        // Create several files all matching the same query
        for (let i = 1; i <= 5; i++) {
            write(
                path.join(root, 'Story', 'EN', 'Act I', `Chapter ${i}.md`),
                `# Chapter ${i}\nThe ancient dragon awoke from slumber in chapter ${i}.\n`
            );
        }
        await toolIndexBuild(root);

        const result = await toolSearch(root, { query: 'ancient dragon', maxResults: 2 });
        // Should have [1] and [2] but not [3]
        expect(result).toContain('[1]');
        expect(result).toContain('[2]');
        expect(result).not.toContain('[3]');
    });

    it('returns results for a natural-language passage query', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Arrival\nThe wandering merchant arrived at the crossroads.\n');
        await toolIndexBuild(root);

        const result = await toolSearch(root, { query: 'wandering merchant' });
        expect(result).toContain('Chapter 1.md');
        expect(result).not.toBe('No results found.');
    });

    it('truncates output when BINDERY_MAX_RESPONSE_BYTES is very small', async () => {
        const root = makeRoot();
        for (let i = 1; i <= 4; i++) {
            write(
                path.join(root, 'Story', 'EN', 'Act I', `Chapter ${i}.md`),
                `# Chapter ${i}\nThe ancient forest held many secrets in chapter ${i}.\n`
            );
        }
        await toolIndexBuild(root);

        process.env['BINDERY_MAX_RESPONSE_BYTES'] = '50';
        const capped = await toolSearch(root, { query: 'ancient forest', maxResults: 4 });

        delete process.env['BINDERY_MAX_RESPONSE_BYTES'];
        const unlimited = await toolSearch(root, { query: 'ancient forest', maxResults: 4 });

        expect(capped.length).toBeLessThan(unlimited.length);
    });

    it('warns and falls back to lexical when semantic_rerank is requested without Ollama', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Arrival\nThe wandering merchant arrived at the crossroads.\n');
        await toolIndexBuild(root);

        const result = await toolSearch(root, { query: 'wandering merchant', mode: 'semantic_rerank' });
        expect(result).toContain('Warning: semantic_rerank requested but BINDERY_OLLAMA_URL is not configured; using lexical results.');
        expect(result).toContain('Chapter 1.md');
    });

    it('warns and falls back to lexical when full_semantic is requested without a semantic index', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Arrival\nThe wandering merchant arrived at the crossroads.\n');
        await toolIndexBuild(root);

        process.env['BINDERY_OLLAMA_URL'] = 'http://localhost:11434';
        const result = await toolSearch(root, { query: 'wandering merchant', mode: 'full_semantic' });

        delete process.env['BINDERY_OLLAMA_URL'];
        expect(result).toContain('Warning: full_semantic requested but the semantic index is unavailable; using lexical results.');
        expect(result).toContain('Chapter 1.md');
    });
});

// ─── Arc folder in lexical index ─────────────────────────────────────────────

describe('Arc folder in lexical index', () => {
    it('indexes Arc .md files alongside Story content', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Ch1\nThe knight arrived at the fortress.\n');
        write(path.join(root, 'Arc', 'act1-arc.md'), '# Arc Notes\nThe fortress siege was planned by the council.\n');
        await toolIndexBuild(root);

        const result = await toolSearch(root, { query: 'fortress siege' });
        expect(result).toContain('act1-arc.md');
    });

    it('does not throw when Arc folder is absent', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Ch1\nThe wanderer set out at dawn.\n');

        await expect(toolIndexBuild(root)).resolves.toContain('Lexical index built:');
    });
});

// ─── Mocked Ollama — semantic_rerank ─────────────────────────────────────────

describe('mocked Ollama — semantic_rerank', () => {
    const mockEmbedding = Array.from({ length: 8 }, (_, i) => (i + 1) / 10);

    afterEach(() => {
        vi.restoreAllMocks();
        delete process.env['BINDERY_OLLAMA_URL'];
    });

    it('reranks lexical results and returns them without a warning', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Voyage\nThe captain sailed into uncharted waters.\n');
        await toolIndexBuild(root);

        process.env['BINDERY_OLLAMA_URL'] = 'http://localhost:11434';

        vi.stubGlobal('fetch', ollamaFetchMock(mockEmbedding));

        const result = await toolSearch(root, { query: 'captain sailed', mode: 'semantic_rerank' });
        expect(result).not.toContain('Warning:');
        expect(result).toContain('Chapter 1.md');
    });

    it('falls back gracefully when Ollama returns non-ok response', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Harbor\nThe ship docked at midnight in a hidden harbor.\n');
        await toolIndexBuild(root);

        process.env['BINDERY_OLLAMA_URL'] = 'http://localhost:11434';

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            json: async () => ({}),
        }));

        const result = await toolSearch(root, { query: 'ship harbor midnight', mode: 'semantic_rerank' });
        expect(result).toContain('Warning:');
        expect(result).toContain('Chapter 1.md');
    });

    it('warns when URL is reachable but not an Ollama API', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Harbor\nThe ship docked at midnight in a hidden harbor.\n');
        await toolIndexBuild(root);

        process.env['BINDERY_OLLAMA_URL'] = 'http://localhost:11434';

        vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: unknown) => {
            const url = String(input);
            if (url.endsWith('/api/tags')) {
                return {
                    ok: true,
                    json: async () => ({ status: 'ok' }),
                };
            }
            return {
                ok: true,
                json: async () => ({ embedding: mockEmbedding }),
            };
        }));

        const result = await toolSearch(root, { query: 'ship harbor midnight', mode: 'semantic_rerank' });
        expect(result).toContain('Warning: semantic_rerank requested but BINDERY_OLLAMA_URL is not an Ollama endpoint; using lexical results.');
        expect(result).toContain('/api/tags response did not contain a models array');
    });

    it('truncates rerank embedding prompts to BINDERY_EMBEDDING_MAX_CHARS', async () => {
        const root = makeRoot();
        const longText = 'Alpha '.repeat(200);
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), `# Long\n${longText}\n`);
        await toolIndexBuild(root);

        process.env['BINDERY_OLLAMA_URL'] = 'http://localhost:11434';
        process.env['BINDERY_EMBEDDING_MAX_CHARS'] = '64';

        const prompts: string[] = [];
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: unknown, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/api/tags')) {
                return {
                    ok: true,
                    json: async () => ({ models: [{ name: 'nomic-embed-text' }] }),
                };
            }
            const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { prompt?: string } : {};
            if (typeof body.prompt === 'string') { prompts.push(body.prompt); }
            return {
                ok: true,
                json: async () => ({ embedding: mockEmbedding }),
            };
        }));

        await toolSearch(root, { query: 'Alpha', mode: 'semantic_rerank' });
        expect(prompts.length).toBeGreaterThan(0);
        expect(prompts.every(p => p.length <= 64)).toBe(true);
    });
});

// ─── Mocked Ollama — buildSemanticIndex + full_semantic ──────────────────────

describe('mocked Ollama — full_semantic', () => {
    const mockEmbedding = Array.from({ length: 8 }, (_, i) => (i + 1) / 10);

    afterEach(() => {
        vi.restoreAllMocks();
        delete process.env['BINDERY_OLLAMA_URL'];
        delete process.env['BINDERY_ENABLE_SEMANTIC_INDEX'];
    });

    it('builds semantic index and reports vector count', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Forest\nThe ancient forest held many secrets.\n');

        process.env['BINDERY_OLLAMA_URL'] = 'http://localhost:11434';
        process.env['BINDERY_ENABLE_SEMANTIC_INDEX'] = 'true';

        vi.stubGlobal('fetch', ollamaFetchMock(mockEmbedding));

        const result = await toolIndexBuild(root);
        expect(result).toContain('Lexical index built:');
        expect(result).toContain('Semantic index built:');
        expect(result).toMatch(/\d+\/\d+ vectors/);
    });

    it('full_semantic returns results ranked by cosine without warning', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Ruins\nThe explorer found the ancient ruins at dusk.\n');

        process.env['BINDERY_OLLAMA_URL'] = 'http://localhost:11434';
        process.env['BINDERY_ENABLE_SEMANTIC_INDEX'] = 'true';

        vi.stubGlobal('fetch', ollamaFetchMock(mockEmbedding));

        // Build the semantic index
        await toolIndexBuild(root);

        // Now search using full_semantic
        const result = await toolSearch(root, { query: 'ancient ruins', mode: 'full_semantic' });
        expect(result).not.toContain('Warning:');
        expect(result).toContain('Chapter 1.md');
    });

    it('full_semantic falls back when Ollama is unreachable at query time', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Desert\nThe nomad crossed the vast desert alone.\n');

        process.env['BINDERY_OLLAMA_URL'] = 'http://localhost:11434';
        process.env['BINDERY_ENABLE_SEMANTIC_INDEX'] = 'true';

        // Build succeeds
        vi.stubGlobal('fetch', ollamaFetchMock(mockEmbedding));
        await toolIndexBuild(root);

        // Query fails
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

        const result = await toolSearch(root, { query: 'nomad desert', mode: 'full_semantic' });
        expect(result).toContain('Warning:');
        expect(result).toContain('using lexical results');
    });

    it('index_build reports non-Ollama endpoint clearly', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Forest\nThe ancient forest held many secrets.\n');

        process.env['BINDERY_OLLAMA_URL'] = 'http://localhost:11434';
        process.env['BINDERY_ENABLE_SEMANTIC_INDEX'] = 'true';

        vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: unknown) => {
            const url = String(input);
            if (url.endsWith('/api/tags')) {
                return {
                    ok: true,
                    json: async () => ({ status: 'ok' }),
                };
            }
            return {
                ok: true,
                json: async () => ({ embedding: mockEmbedding }),
            };
        }));

        const result = await toolIndexBuild(root);
        expect(result).toContain('Semantic index failed: Semantic indexing requires an Ollama server.');
        expect(result).toContain('/api/tags response did not contain a models array');
    });

    it('truncates semantic index embedding prompts to BINDERY_EMBEDDING_MAX_CHARS', async () => {
        const root = makeRoot();
        const longText = 'Forest '.repeat(220);
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), `# Forest\n${longText}\n`);

        process.env['BINDERY_OLLAMA_URL'] = 'http://localhost:11434';
        process.env['BINDERY_ENABLE_SEMANTIC_INDEX'] = 'true';
        process.env['BINDERY_EMBEDDING_MAX_CHARS'] = '80';

        const prompts: string[] = [];
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: unknown, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/api/tags')) {
                return {
                    ok: true,
                    json: async () => ({ models: [{ name: 'nomic-embed-text' }] }),
                };
            }
            const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { prompt?: string } : {};
            if (typeof body.prompt === 'string') { prompts.push(body.prompt); }
            return {
                ok: true,
                json: async () => ({ embedding: mockEmbedding }),
            };
        }));

        await toolIndexBuild(root);
        expect(prompts.length).toBeGreaterThan(0);
        expect(prompts.every(p => p.length <= 80)).toBe(true);
    });
});

function ollamaFetchMock(mockEmbedding: number[]) {
    return vi.fn().mockImplementation(async (input: unknown) => {
        const url = String(input);
        if (url.endsWith('/api/tags')) {
            return {
                ok: true,
                json: async () => ({ models: [{ name: 'nomic-embed-text' }] }),
            };
        }
        return {
            ok: true,
            json: async () => ({ embedding: mockEmbedding }),
        };
    });
}
