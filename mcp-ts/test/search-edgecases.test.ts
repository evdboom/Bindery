import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    toolSearch,
    toolRetrieveContext,
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
    for (const root of tempRoots.splice(0, tempRoots.length)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// ─── toolIndexStatus ──────────────────────────────────────────────────────────

describe('toolIndexStatus', () => {
    it('reports "No index found" before any build', () => {
        const root = makeRoot();
        const result = toolIndexStatus(root);
        expect(result).toContain('No index found');
    });

    it('reports chunk count and build time after build', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Ch1\nThe silver moon rose over the mountains.\n');

        toolIndexBuild(root);

        const result = toolIndexStatus(root);
        expect(result).toContain('chunks:');
        expect(result).toContain('built:');
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
        toolIndexBuild(root);

        const result = await toolSearch(root, { query: 'silver knight', language: 'EN' });
        expect(result).toContain('EN');
        expect(result).not.toContain('NL');
    });

    it('returns "No results found." when query matches nothing', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Ch1\nThe wizard cast a spell.\n');
        toolIndexBuild(root);

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
        toolIndexBuild(root);

        const result = await toolSearch(root, { query: 'ancient dragon', maxResults: 2 });
        // Should have [1] and [2] but not [3]
        expect(result).toContain('[1]');
        expect(result).toContain('[2]');
        expect(result).not.toContain('[3]');
    });
});

// ─── toolRetrieveContext ──────────────────────────────────────────────────────

describe('toolRetrieveContext', () => {
    it('returns context for a matching query', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Arrival\nThe wandering merchant arrived at the crossroads.\n');
        toolIndexBuild(root);

        const result = await toolRetrieveContext(root, { query: 'wandering merchant' });
        expect(result).toContain('Chapter 1.md');
        expect(result).not.toBe('No context found.');
    });

    it('returns "No context found." for unmatched query', async () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Ch1\nThe blacksmith hammered the sword.\n');
        toolIndexBuild(root);

        const result = await toolRetrieveContext(root, { query: 'xyzzy zork frotz' });
        expect(result).toBe('No context found.');
    });

    it('truncates output when BINDERY_MAX_RESPONSE_BYTES is very small', async () => {
        const root = makeRoot();
        // Create several files to ensure multiple results
        for (let i = 1; i <= 4; i++) {
            write(
                path.join(root, 'Story', 'EN', 'Act I', `Chapter ${i}.md`),
                `# Chapter ${i}\nThe ancient forest held many secrets in chapter ${i}.\n`
            );
        }
        toolIndexBuild(root);

        // Set a very small budget — only the first result should fit
        process.env['BINDERY_MAX_RESPONSE_BYTES'] = '50';

        const full = await toolRetrieveContext(root, { query: 'ancient forest', topK: 4 });

        delete process.env['BINDERY_MAX_RESPONSE_BYTES'];
        const unlimited = await toolRetrieveContext(root, { query: 'ancient forest', topK: 4 });

        // With a tiny budget the result must be shorter (or empty, capped at 0 parts)
        expect(full.length).toBeLessThan(unlimited.length);
    });
});
