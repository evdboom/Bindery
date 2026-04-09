/**
 * Search — BM25 index via MiniSearch, with optional Ollama-assisted reranking
 * and an optional full semantic index persisted separately from the lexical
 * index.
 */

import * as crypto from 'crypto';
import * as fs     from 'fs';
import * as path   from 'path';
import MiniSearch from 'minisearch';
import { chunkWorkspace, type Chunk } from './docstore.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SearchMode = 'lexical' | 'semantic_rerank' | 'full_semantic';
export type SearchSource = 'bm25' | 'ollama-reranked' | 'ollama-semantic';

export interface SearchResult {
    chunk:    Chunk;
    score:    number;
    source:   SearchSource;
}

export interface SearchOperationOutcome {
    results:      SearchResult[];
    usedSemantic: boolean;
    warning?:     string;
}

export interface IndexMeta {
    builtAt:          string;
    chunkCount:       number;
    root:             string;
    contentSignature: string;
}

export interface SemanticIndexMeta {
    builtAt:               string;
    chunkCount:            number;
    vectorCount:           number;
    root:                  string;
    model:                 string;
    contentSignature:      string;
    chapterStatusSignature: string;
}

export interface SemanticIndexEntry {
    chunkId: string;
    vector:  number[];
}

export interface LoadedIndex {
    ms:     MiniSearch;
    chunks: Chunk[];
    meta:   IndexMeta;
}

export interface LoadedSemanticIndex {
    chunks:     Chunk[];
    embeddings: SemanticIndexEntry[];
    meta:       SemanticIndexMeta;
}

export interface SemanticIndexStaleness {
    isStale:                boolean;
    contentChanged:         boolean;
    statusTransitionStale:  boolean;
    changedChunkCount:      number;
    currentContentSignature: string;
    currentChapterStatusSignature: string;
    reasons:                string[];
}

interface PersistedIndex {
    meta:   IndexMeta;
    chunks: Chunk[];
    index:  ReturnType<MiniSearch['toJSON']>;
}

interface PersistedSemanticIndex {
    meta:       SemanticIndexMeta;
    chunks:     Chunk[];
    embeddings: SemanticIndexEntry[];
}

// ─── Paths ───────────────────────────────────────────────────────────────────

export function indexPath(root: string): string {
    return path.join(root, '.bindery', 'mcp-index.json');
}

export function semanticIndexPath(root: string): string {
    return path.join(root, '.bindery', 'mcp-semantic-index.json');
}

// ─── Build ────────────────────────────────────────────────────────────────────

export function buildIndex(root: string): LoadedIndex {
    const chunks = chunkWorkspace(root, { includeArc: true });

    const ms = new MiniSearch<Chunk>({
        idField: 'id',
        fields: ['text', 'relPath'],
        storeFields: ['id', 'relPath', 'absPath', 'startLine', 'endLine', 'text', 'language'],
        searchOptions: { boost: { text: 2 }, fuzzy: 0.1 },
    });
    ms.addAll(chunks);

    const meta: IndexMeta = {
        builtAt: new Date().toISOString(),
        chunkCount: chunks.length,
        root,
        contentSignature: contentSignatureForChunks(chunks),
    };

    const persisted: PersistedIndex = { meta, chunks, index: ms.toJSON() };
    const target = indexPath(root);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(persisted), 'utf-8');

    return { ms, chunks, meta };
}

export async function buildSemanticIndex(root: string): Promise<LoadedSemanticIndex> {
    const ollama = ollamaConfig();
    if (!ollama.url) {
        throw new Error('Semantic indexing requires BINDERY_OLLAMA_URL.');
    }

    const endpointIssue = await validateOllamaEndpoint(ollama.url);
    if (endpointIssue) {
        throw new Error(`Semantic indexing requires an Ollama server. ${endpointIssue}`);
    }

    const chunks = chunkWorkspace(root, semanticDiscoverOptions());
    const embeddings: SemanticIndexEntry[] = [];

    for (const chunk of chunks) {
        const vector = await fetchEmbedding(ollama.url, ollama.model, chunk.text);
        if (vector) {
            embeddings.push({ chunkId: chunk.id, vector });
        }
    }

    const meta: SemanticIndexMeta = {
        builtAt: new Date().toISOString(),
        chunkCount: chunks.length,
        vectorCount: embeddings.length,
        root,
        model: ollama.model,
        contentSignature: contentSignatureForChunks(chunks),
        chapterStatusSignature: chapterStatusSignature(root),
    };

    const persisted: PersistedSemanticIndex = { meta, chunks, embeddings };
    const target = semanticIndexPath(root);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(persisted), 'utf-8');

    return { chunks, embeddings, meta };
}

// ─── Load ─────────────────────────────────────────────────────────────────────

export function loadIndex(root: string): LoadedIndex | null {
    const p = indexPath(root);
    if (!fs.existsSync(p)) { return null; }
    try {
        const data: PersistedIndex = JSON.parse(fs.readFileSync(p, 'utf-8'));
        const ms = MiniSearch.loadJSON<Chunk>(JSON.stringify(data.index), {
            idField: 'id',
            fields: ['text', 'relPath'],
            storeFields: ['id', 'relPath', 'absPath', 'startLine', 'endLine', 'text', 'language'],
            searchOptions: { boost: { text: 2 }, fuzzy: 0.1 },
        });
        return { ms, chunks: data.chunks, meta: data.meta };
    } catch {
        return null;
    }
}

export function loadSemanticIndex(root: string): LoadedSemanticIndex | null {
    const p = semanticIndexPath(root);
    if (!fs.existsSync(p)) { return null; }
    try {
        const data: PersistedSemanticIndex = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return { chunks: data.chunks, embeddings: data.embeddings, meta: data.meta };
    } catch {
        return null;
    }
}

// ─── Search ───────────────────────────────────────────────────────────────────

export function search(
    ms:        MiniSearch,
    chunks:    Chunk[],
    query:     string,
    topK:      number = 6,
    language?: string,
): SearchResult[] {
    const raw = ms.search(query, { prefix: true, fuzzy: 0.1 });
    const chunkMap = new Map(chunks.map(c => [c.id, c]));

    let results: SearchResult[] = [];
    for (const hit of raw) {
        const chunk = chunkMap.get(hit.id);
        if (chunk) {
            results.push({ chunk, score: hit.score, source: 'bm25' });
        }
    }

    results = filterByLanguage(results, language);
    return results.slice(0, topK);
}

export async function rerank(
    results: SearchResult[],
    query:   string,
): Promise<SearchOperationOutcome> {
    const ollama = ollamaConfig();
    if (!ollama.url) {
        return {
            results,
            usedSemantic: false,
            warning: 'semantic_rerank requested but BINDERY_OLLAMA_URL is not configured; using lexical results.',
        };
    }
    if (results.length === 0) {
        return { results, usedSemantic: false };
    }

    const endpointIssue = await validateOllamaEndpoint(ollama.url);
    if (endpointIssue) {
        return {
            results,
            usedSemantic: false,
            warning: `semantic_rerank requested but BINDERY_OLLAMA_URL is not an Ollama endpoint; using lexical results. ${endpointIssue}`,
        };
    }

    try {
        const queryVec = await fetchEmbedding(ollama.url, ollama.model, query);
        if (!queryVec) {
            return {
                results,
                usedSemantic: false,
                warning: 'semantic_rerank requested but Ollama embeddings were unavailable; using lexical results.',
            };
        }

        const scored: SearchResult[] = [];
        for (const result of results) {
            const vector = await fetchEmbedding(ollama.url, ollama.model, result.chunk.text);
            if (!vector) {
                scored.push(result);
                continue;
            }
            scored.push({ ...result, score: cosine(queryVec, vector), source: 'ollama-reranked' });
        }

        scored.sort((a, b) => b.score - a.score);
        return { results: scored, usedSemantic: true };
    } catch {
        return {
            results,
            usedSemantic: false,
            warning: 'semantic_rerank requested but Ollama could not be reached; using lexical results.',
        };
    }
}

export async function fullSemanticSearch(
    root:     string,
    query:    string,
    topK:     number,
    language?: string,
): Promise<SearchOperationOutcome> {
    const ollama = ollamaConfig();
    if (!ollama.url) {
        return {
            results: [],
            usedSemantic: false,
            warning: 'full_semantic requested but BINDERY_OLLAMA_URL is not configured; using lexical results.',
        };
    }

    const semantic = loadSemanticIndex(root);
    if (!semantic || semantic.embeddings.length === 0) {
        return {
            results: [],
            usedSemantic: false,
            warning: 'full_semantic requested but the semantic index is unavailable; using lexical results.',
        };
    }

    const endpointIssue = await validateOllamaEndpoint(ollama.url);
    if (endpointIssue) {
        return {
            results: [],
            usedSemantic: false,
            warning: `full_semantic requested but BINDERY_OLLAMA_URL is not an Ollama endpoint; using lexical results. ${endpointIssue}`,
        };
    }

    try {
        const queryVector = await fetchEmbedding(ollama.url, ollama.model, query);
        if (!queryVector) {
            return {
                results: [],
                usedSemantic: false,
                warning: 'full_semantic requested but the query embedding could not be computed; using lexical results.',
            };
        }

        const chunkMap = new Map(semantic.chunks.map(chunk => [chunk.id, chunk]));
        const scored: SearchResult[] = [];

        for (const entry of semantic.embeddings) {
            const chunk = chunkMap.get(entry.chunkId);
            if (!chunk) { continue; }
            if (language && language !== 'ALL' && chunk.language && chunk.language !== language.toUpperCase()) {
                continue;
            }
            scored.push({
                chunk,
                score: cosine(queryVector, entry.vector),
                source: 'ollama-semantic',
            });
        }

        scored.sort((a, b) => b.score - a.score);
        return { results: scored.slice(0, topK), usedSemantic: true };
    } catch {
        return {
            results: [],
            usedSemantic: false,
            warning: 'full_semantic requested but Ollama could not be reached; using lexical results.',
        };
    }
}

export function semanticIndexStaleness(root: string, semantic: LoadedSemanticIndex): SemanticIndexStaleness {
    const currentChunks = chunkWorkspace(root, semanticDiscoverOptions());
    const currentContentSignature = contentSignatureForChunks(currentChunks);
    const currentChapterStatusSignature = chapterStatusSignature(root);
    const currentIds = new Set(currentChunks.map(chunk => chunk.id));
    const indexedIds = new Set(semantic.chunks.map(chunk => chunk.id));

    let changedChunkCount = 0;
    for (const id of currentIds) {
        if (!indexedIds.has(id)) { changedChunkCount++; }
    }
    for (const id of indexedIds) {
        if (!currentIds.has(id)) { changedChunkCount++; }
    }

    const contentChanged = currentContentSignature !== semantic.meta.contentSignature;
    const statusTransitionStale = currentChapterStatusSignature !== semantic.meta.chapterStatusSignature;
    const reasons: string[] = [];
    if (statusTransitionStale) {
        reasons.push('chapter status changed to or from a rebuild-worthy state');
    }
    if (contentChanged) {
        reasons.push(`semantic corpus changed since indexing (${changedChunkCount} changed chunk${changedChunkCount === 1 ? '' : 's'})`);
    }

    return {
        isStale: statusTransitionStale || contentChanged,
        contentChanged,
        statusTransitionStale,
        changedChunkCount,
        currentContentSignature,
        currentChapterStatusSignature,
        reasons,
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function semanticDiscoverOptions() {
    return { includeArc: true } as const;
}

function ollamaConfig(): { url: string | null; model: string } {
    return {
        url: process.env['BINDERY_OLLAMA_URL']?.trim() || null,
        model: process.env['BINDERY_OLLAMA_MODEL'] ?? 'nomic-embed-text',
    };
}

function filterByLanguage(results: SearchResult[], language?: string): SearchResult[] {
    if (!language || language === 'ALL') { return results; }
    const lang = language.toUpperCase();
    return results.filter(r => !r.chunk.language || r.chunk.language === lang);
}

function contentSignatureForChunks(chunks: Chunk[]): string {
    const hash = crypto.createHash('sha256');
    for (const chunk of chunks) {
        hash.update(chunk.id);
        hash.update('\n');
    }
    return hash.digest('hex').slice(0, 16);
}

function chapterStatusSignature(root: string): string {
    const filePath = path.join(root, '.bindery', 'chapter-status.json');
    if (!fs.existsSync(filePath)) { return 'none'; }

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
            chapters?: Array<{ number: number; language?: string; status?: string }>;
        };
        const interesting = (parsed.chapters ?? [])
            .filter(chapter => chapter.status === 'done' || chapter.status === 'needs-review')
            .map(chapter => `${(chapter.language ?? 'EN').toUpperCase()}:${chapter.number}:${chapter.status}`)
            .sort()
            .join('|');
        return interesting || 'none';
    } catch {
        return 'unreadable';
    }
}

async function fetchEmbedding(
    baseUrl: string,
    model:   string,
    text:    string,
): Promise<number[] | null> {
    const url = baseUrl.replace(/\/$/, '') + '/api/embeddings';
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text }),
        signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { return null; }
    const json = await res.json() as { embedding?: number[] };
    return json.embedding ?? null;
}

async function validateOllamaEndpoint(baseUrl: string): Promise<string | null> {
    const url = baseUrl.replace(/\/$/, '') + '/api/tags';
    try {
        const res = await fetch(url, {
            method: 'GET',
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
            return `Endpoint check failed (GET /api/tags returned HTTP ${res.status}).`;
        }
        const json = await res.json() as { models?: unknown };
        if (!Array.isArray(json.models)) {
            return 'Endpoint check failed (/api/tags response did not contain a models array).';
        }
        return null;
    } catch {
        return 'Endpoint check failed (could not reach GET /api/tags).';
    }
}

function cosine(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) { return 0; }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}
