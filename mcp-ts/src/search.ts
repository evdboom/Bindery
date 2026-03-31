/**
 * Search — BM25 index via MiniSearch, with optional Ollama-assisted reranking.
 *
 * Index is persisted to .bindery/mcp-index.json so it survives across MCP
 * server restarts without a full rebuild.
 */

import * as fs   from 'fs';
import * as path from 'path';
import MiniSearch from 'minisearch';
import { chunkWorkspace, type Chunk, type DiscoverOptions } from './docstore.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SearchResult {
    chunk:    Chunk;
    score:    number;
    source:   'bm25' | 'ollama-reranked';
}

export interface IndexMeta {
    builtAt:    string;
    chunkCount: number;
    root:       string;
}

interface PersistedIndex {
    meta:   IndexMeta;
    chunks: Chunk[];
    index:  ReturnType<MiniSearch['toJSON']>;
}

// ─── Index path ───────────────────────────────────────────────────────────────

export function indexPath(root: string): string {
    return path.join(root, '.bindery', 'mcp-index.json');
}

// ─── Build ────────────────────────────────────────────────────────────────────

export function buildIndex(root: string): { ms: MiniSearch; chunks: Chunk[]; meta: IndexMeta } {
    const chunks = chunkWorkspace(root);

    const ms = new MiniSearch<Chunk>({
        idField:    'id',
        fields:     ['text', 'relPath'],
        storeFields: ['id', 'relPath', 'absPath', 'startLine', 'endLine', 'text', 'language'],
        searchOptions: { boost: { text: 2 }, fuzzy: 0.1 },
    });
    ms.addAll(chunks);

    const meta: IndexMeta = {
        builtAt:    new Date().toISOString(),
        chunkCount: chunks.length,
        root,
    };

    // Persist
    const p = indexPath(root);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const data: PersistedIndex = { meta, chunks, index: ms.toJSON() };
    fs.writeFileSync(p, JSON.stringify(data), 'utf-8');

    return { ms, chunks, meta };
}

// ─── Load ─────────────────────────────────────────────────────────────────────

export function loadIndex(root: string): { ms: MiniSearch; chunks: Chunk[]; meta: IndexMeta } | null {
    const p = indexPath(root);
    if (!fs.existsSync(p)) { return null; }
    try {
        const data: PersistedIndex = JSON.parse(fs.readFileSync(p, 'utf-8'));
        const ms = MiniSearch.loadJSON<Chunk>(JSON.stringify(data.index), {
            idField:    'id',
            fields:     ['text', 'relPath'],
            storeFields: ['id', 'relPath', 'absPath', 'startLine', 'endLine', 'text', 'language'],
            searchOptions: { boost: { text: 2 }, fuzzy: 0.1 },
        });
        return { ms, chunks: data.chunks, meta: data.meta };
    } catch {
        return null;
    }
}

// ─── Search ───────────────────────────────────────────────────────────────────

export function search(
    ms:       MiniSearch,
    chunks:   Chunk[],
    query:    string,
    topK:     number = 6,
    language?: string,
): SearchResult[] {
    const raw = ms.search(query, { prefix: true, fuzzy: 0.1 });

    // Build chunk lookup
    const chunkMap = new Map(chunks.map(c => [c.id, c]));

    let results: SearchResult[] = [];
    for (const hit of raw) {
        const chunk = chunkMap.get(hit.id);
        if (chunk) { results.push({ chunk, score: hit.score, source: 'bm25' }); }
    }

    // Language filter
    if (language && language !== 'ALL') {
        const lang = language.toUpperCase();
        results = results.filter(r => !r.chunk.language || r.chunk.language === lang);
    }

    return results.slice(0, topK);
}

// ─── Optional Ollama reranking ────────────────────────────────────────────────

/**
 * If BINDERY_OLLAMA_URL is set and has an embeddings endpoint, fetch a query
 * embedding and cosine-rerank the BM25 candidates.
 *
 * This is best-effort — if Ollama is unreachable we silently return the
 * original BM25 results.
 */
export async function rerank(
    results: SearchResult[],
    query:   string,
): Promise<SearchResult[]> {
    const ollamaUrl = process.env['BINDERY_OLLAMA_URL'];
    const model     = process.env['BINDERY_OLLAMA_MODEL'] ?? 'nomic-embed-text';
    if (!ollamaUrl || results.length === 0) { return results; }

    try {
        const queryVec = await fetchEmbedding(ollamaUrl, model, query);
        if (!queryVec) { return results; }

        // Embed all candidates and cosine-score them against the query
        const scored: SearchResult[] = [];
        for (const r of results) {
            try {
                const vec = await fetchEmbedding(ollamaUrl, model, r.chunk.text.slice(0, 512));
                if (vec) {
                    const sim = cosine(queryVec, vec);
                    scored.push({ ...r, score: sim, source: 'ollama-reranked' });
                } else {
                    scored.push(r);
                }
            } catch {
                scored.push(r);
            }
        }
        scored.sort((a, b) => b.score - a.score);
        return scored;
    } catch {
        return results;
    }
}

async function fetchEmbedding(
    baseUrl: string,
    model:   string,
    text:    string,
): Promise<number[] | null> {
    const url = baseUrl.replace(/\/$/, '') + '/api/embeddings';
    const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model, prompt: text }),
        signal:  AbortSignal.timeout(5000),
    });
    if (!res.ok) { return null; }
    const json = await res.json() as { embedding?: number[] };
    return json.embedding ?? null;
}

function cosine(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot   += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}
