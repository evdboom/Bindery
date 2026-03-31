"use strict";
/**
 * Search — BM25 index via MiniSearch, with optional Ollama-assisted reranking.
 *
 * Index is persisted to .bindery/mcp-index.json so it survives across MCP
 * server restarts without a full rebuild.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.indexPath = indexPath;
exports.buildIndex = buildIndex;
exports.loadIndex = loadIndex;
exports.search = search;
exports.rerank = rerank;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const minisearch_1 = __importDefault(require("minisearch"));
const docstore_js_1 = require("./docstore.js");
// ─── Index path ───────────────────────────────────────────────────────────────
function indexPath(root) {
    return path.join(root, '.bindery', 'mcp-index.json');
}
// ─── Build ────────────────────────────────────────────────────────────────────
function buildIndex(root) {
    const chunks = (0, docstore_js_1.chunkWorkspace)(root);
    const ms = new minisearch_1.default({
        idField: 'id',
        fields: ['text', 'relPath'],
        storeFields: ['id', 'relPath', 'absPath', 'startLine', 'endLine', 'text', 'language'],
        searchOptions: { boost: { text: 2 }, fuzzy: 0.1 },
    });
    ms.addAll(chunks);
    const meta = {
        builtAt: new Date().toISOString(),
        chunkCount: chunks.length,
        root,
    };
    // Persist
    const p = indexPath(root);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const data = { meta, chunks, index: ms.toJSON() };
    fs.writeFileSync(p, JSON.stringify(data), 'utf-8');
    return { ms, chunks, meta };
}
// ─── Load ─────────────────────────────────────────────────────────────────────
function loadIndex(root) {
    const p = indexPath(root);
    if (!fs.existsSync(p)) {
        return null;
    }
    try {
        const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
        const ms = minisearch_1.default.loadJSON(JSON.stringify(data.index), {
            idField: 'id',
            fields: ['text', 'relPath'],
            storeFields: ['id', 'relPath', 'absPath', 'startLine', 'endLine', 'text', 'language'],
            searchOptions: { boost: { text: 2 }, fuzzy: 0.1 },
        });
        return { ms, chunks: data.chunks, meta: data.meta };
    }
    catch {
        return null;
    }
}
// ─── Search ───────────────────────────────────────────────────────────────────
function search(ms, chunks, query, topK = 6, language) {
    const raw = ms.search(query, { prefix: true, fuzzy: 0.1 });
    // Build chunk lookup
    const chunkMap = new Map(chunks.map(c => [c.id, c]));
    let results = [];
    for (const hit of raw) {
        const chunk = chunkMap.get(hit.id);
        if (chunk) {
            results.push({ chunk, score: hit.score, source: 'bm25' });
        }
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
async function rerank(results, query) {
    const ollamaUrl = process.env['BINDERY_OLLAMA_URL'];
    const model = process.env['BINDERY_OLLAMA_MODEL'] ?? 'nomic-embed-text';
    if (!ollamaUrl || results.length === 0) {
        return results;
    }
    try {
        const queryVec = await fetchEmbedding(ollamaUrl, model, query);
        if (!queryVec) {
            return results;
        }
        // Embed all candidates and cosine-score them against the query
        const scored = [];
        for (const r of results) {
            try {
                const vec = await fetchEmbedding(ollamaUrl, model, r.chunk.text.slice(0, 512));
                if (vec) {
                    const sim = cosine(queryVec, vec);
                    scored.push({ ...r, score: sim, source: 'ollama-reranked' });
                }
                else {
                    scored.push(r);
                }
            }
            catch {
                scored.push(r);
            }
        }
        scored.sort((a, b) => b.score - a.score);
        return scored;
    }
    catch {
        return results;
    }
}
async function fetchEmbedding(baseUrl, model, text) {
    const url = baseUrl.replace(/\/$/, '') + '/api/embeddings';
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text }),
        signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
        return null;
    }
    const json = await res.json();
    return json.embedding ?? null;
}
function cosine(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}
//# sourceMappingURL=search.js.map