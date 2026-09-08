#!/usr/bin/env node
/**
 * Reproducible local benchmark harness for Bindery.
 *
 * Measures three operations against a generated, deterministic fixture:
 *   1. Markdown-only merge   (@bindery/merge → mergeBook)
 *   2. Lexical index build   (bindery-mcp/out/search.js → buildIndex)
 *   3. Repeated lexical query (bindery-mcp/out/search.js → search)
 *
 * Node built-ins only. No dependencies, no committed result files, no thresholds.
 *
 * Usage:
 *   npm run benchmark
 *   npm run benchmark -- --chapters 10 --words 500
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';

// ─── Defaults (conservative: finish quickly on a laptop) ─────────────────────

const DEFAULT_CHAPTERS = 5;
const DEFAULT_WORDS = 200;
const WARMUP_COUNT = 3;
const SAMPLE_COUNT = 10;

// ─── CLI parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
    const opts = { chapters: DEFAULT_CHAPTERS, words: DEFAULT_WORDS };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--chapters' || arg === '--words') {
            const key = arg === '--chapters' ? 'chapters' : 'words';
            const raw = argv[++i];
            const n = Number(raw);
            if (!Number.isInteger(n) || n <= 0) {
                console.error(`Invalid value for ${arg}: "${raw ?? ''}" (expected a positive integer).`);
                process.exit(1);
            }
            opts[key] = n;
        } else {
            console.error(`Unknown argument: ${arg}`);
            console.error('Usage: npm run benchmark [--chapters <n>] [--words <n>]');
            process.exit(1);
        }
    }
    return opts;
}

// ─── Fixture generation (deterministic) ──────────────────────────────────────

/**
 * Generate a deterministic book fixture under `root`.
 * Chapters live in Story/EN/Act I/ so both the merge and the lexical
 * index discover them. Content is a pure function of (chapter, word index),
 * so two runs produce byte-identical fixtures.
 */
function generateFixture(root, chapters, words) {
    const actDir = path.join(root, 'Story', 'EN', 'Act I');
    fs.mkdirSync(actDir, { recursive: true });

    for (let c = 1; c <= chapters; c++) {
        const words = [];
        for (let w = 0; w < words; w++) {
            // Deterministic pseudo-vocabulary; stable across runs and platforms.
            words.push(`word${(c * 1000 + w) % 5000}`);
        }
        const body = `# Chapter ${c}\n\n${words.join(' ')}\n`;
        fs.writeFileSync(path.join(actDir, `Chapter${c}.md`), body, 'utf-8');
    }
}

// ─── Timing helpers ──────────────────────────────────────────────────────────

/**
 * Run `fn` warmupCount times (untimed), then sampleCount times (timed).
 * Returns { medianMs, p95Ms } over the timed samples.
 */
async function measure(fn, warmupCount, sampleCount) {
    for (let i = 0; i < warmupCount; i++) {
        await fn();
    }
    const samples = [];
    for (let i = 0; i < sampleCount; i++) {
        const start = performance.now();
        await fn();
        samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const medianMs = samples[Math.floor((samples.length - 1) / 2)];
    const p95Ms = samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)];
    return { medianMs: round2(medianMs), p95Ms: round2(p95Ms) };
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

// ─── Operation runners ───────────────────────────────────────────────────────

const EN_LANGUAGE = {
    code: 'EN',
    folderName: 'EN',
    chapterWord: 'Chapter',
    actPrefix: 'Act',
    prologueLabel: 'Prologue',
    epilogueLabel: 'Epilogue',
    isDefault: true,
};

function makeMergeOptions(root) {
    return {
        root,
        storyFolder: 'Story',
        language: EN_LANGUAGE,
        outputTypes: ['md'],
        includeToc: false,
        includeSeparators: false,
        outputDir: 'Merged',
        filePrefix: 'Book',
        pandocPath: 'pandoc', // unused for md-only output
    };
}

/**
 * Run the three benchmarks. Returns the operations object for the JSON report.
 * Throws on any operation failure so the caller's finally block cleans up.
 */
async function runBenchmarks(root, { chapters, words }) {
    const { mergeBook } = await import('@bindery/merge');
    const { buildIndex, search } = await import('bindery-mcp/out/search.js');

    // 1. Markdown-only merge
    const merge = await measure(
        () => mergeBook(makeMergeOptions(root)),
        WARMUP_COUNT,
        SAMPLE_COUNT,
    );

    // 2. Lexical index build
    const indexBuild = await measure(
        () => buildIndex(root),
        WARMUP_COUNT,
        SAMPLE_COUNT,
    );

    // 3. Repeated lexical query — build one index (untimed) so queries have data.
    const { ms, chunks } = buildIndex(root);
    const query = 'word1';
    const searchOp = await measure(
        () => search(ms, chunks, query, 10),
        WARMUP_COUNT,
        SAMPLE_COUNT,
    );

    return { merge, indexBuild, search: searchOp };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const { chapters, words } = parseArgs(process.argv.slice(2));

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-benchmark-'));
    try {
        generateFixture(root, chapters, words);

        const operations = await runBenchmarks(root, { chapters, words });

        const report = {
            nodeVersion: process.version,
            platform: process.platform,
            fixture: { chapters, wordsPerChapter: words },
            warmupCount: WARMUP_COUNT,
            sampleCount: SAMPLE_COUNT,
            operations,
        };

        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main().catch((err) => {
    console.error(`Benchmark failed: ${err && err.message ? err.message : err}`);
    process.exit(1);
});