import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import {
    scanReviewMarkers,
    stripReviewMarkers,
    REVIEW_START_MARKER,
    REVIEW_STOP_MARKER,
} from '../src/tools-review-markers';
import { toolGetReviewText } from '../src/tools';

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe('scanReviewMarkers', () => {
    it('returns no regions when markers are absent', () => {
        const r = scanReviewMarkers('# A\n\nplain text\n');
        expect(r.regions).toEqual([]);
        expect(r.warnings).toEqual([]);
    });

    it('captures a single closed region', () => {
        const text =
            'a\n' +
            REVIEW_START_MARKER + '\n' +
            'inside1\n' +
            'inside2\n' +
            REVIEW_STOP_MARKER + '\n' +
            'b\n';
        const r = scanReviewMarkers(text);
        expect(r.regions).toHaveLength(1);
        expect(r.regions[0].lines).toEqual(['inside1', 'inside2']);
        expect(r.regions[0].openEnded).toBe(false);
        expect(r.regions[0].startLine).toBe(2);
        expect(r.regions[0].stopLine).toBe(5);
        expect(r.warnings).toEqual([]);
    });

    it('treats unclosed start as open-ended and warns', () => {
        const text = REVIEW_START_MARKER + '\nfoo\nbar\n';
        const r = scanReviewMarkers(text);
        expect(r.regions).toHaveLength(1);
        expect(r.regions[0].openEnded).toBe(true);
        expect(r.regions[0].lines).toEqual(['foo', 'bar', '']);
        expect(r.warnings[0]).toMatch(/unclosed review-start/);
    });

    it('warns and ignores a stop marker without a start', () => {
        const r = scanReviewMarkers('hello\n' + REVIEW_STOP_MARKER + '\n');
        expect(r.regions).toEqual([]);
        expect(r.warnings[0]).toMatch(/without a preceding start/);
    });

    it('warns about nested start markers and keeps outer region', () => {
        const text =
            REVIEW_START_MARKER + '\n' +
            'outer\n' +
            REVIEW_START_MARKER + '\n' +
            'still outer\n' +
            REVIEW_STOP_MARKER + '\n';
        const r = scanReviewMarkers(text);
        expect(r.regions).toHaveLength(1);
        expect(r.regions[0].lines).toContain('outer');
        expect(r.regions[0].lines).toContain('still outer');
        expect(r.warnings.some(w => /nested review-start/.test(w))).toBe(true);
    });

    it('captures multiple regions', () => {
        const text =
            REVIEW_START_MARKER + '\nA\n' + REVIEW_STOP_MARKER + '\n' +
            'middle\n' +
            REVIEW_START_MARKER + '\nB\n' + REVIEW_STOP_MARKER + '\n';
        const r = scanReviewMarkers(text);
        expect(r.regions).toHaveLength(2);
        expect(r.regions[0].lines).toEqual(['A']);
        expect(r.regions[1].lines).toEqual(['B']);
    });
});

describe('stripReviewMarkers', () => {
    it('removes both marker variants and reports the count', () => {
        const text = `a\n${REVIEW_START_MARKER}\nb\n${REVIEW_STOP_MARKER}\nc\n`;
        const { text: out, removed } = stripReviewMarkers(text);
        expect(removed).toBe(2);
        expect(out).toBe('a\nb\nc\n');
    });

    it('is a no-op when no markers are present', () => {
        const { text, removed } = stripReviewMarkers('hello\nworld\n');
        expect(removed).toBe(0);
        expect(text).toBe('hello\nworld\n');
    });
});

// ─── Integration: toolGetReviewText ───────────────────────────────────────────

const tempRoots: string[] = [];

function makeRoot(): string {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-marker-test-'));
    tempRoots.push(r);
    return r;
}

function makeGitRepo(): string {
    const root = makeRoot();
    spawnSync('git', ['init'], { cwd: root });
    spawnSync('git', ['config', 'user.email', 'test@bindery.test'], { cwd: root });
    spawnSync('git', ['config', 'user.name', 'Bindery Test'], { cwd: root });
    spawnSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: root });
    return root;
}

function write(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
}

afterEach(() => {
    for (const r of tempRoots.splice(0, tempRoots.length)) {
        fs.rmSync(r, { recursive: true, force: true });
    }
});

describe('toolGetReviewText — review markers', () => {
    it('returns marker regions even when there is no unstaged diff', () => {
        const root = makeGitRepo();
        const file = path.join(root, 'Story', 'EN', 'Chapter 1.md');
        const body =
            `# Chapter\n` +
            `Stable line.\n` +
            `${REVIEW_START_MARKER}\n` +
            `Please review this paragraph.\n` +
            `${REVIEW_STOP_MARKER}\n` +
            `Trailing line.\n`;
        write(file, body);
        spawnSync('git', ['add', '.'], { cwd: root });
        spawnSync('git', ['commit', '-m', 'add chapter with marker'], { cwd: root });

        const out = toolGetReviewText(root, {});
        expect(out).toContain('# Review markers');
        expect(out).toContain('Please review this paragraph.');
        expect(out).not.toContain('# Git diff');
    });

    it('combines diff and marker sections when both are present', () => {
        const root = makeGitRepo();
        const file = path.join(root, 'Story', 'EN', 'Chapter 1.md');
        write(file, `# Chapter\nOriginal.\n`);
        spawnSync('git', ['add', '.'], { cwd: root });
        spawnSync('git', ['commit', '-m', 'init chapter'], { cwd: root });

        // Now: add an unstaged change AND a marker region
        fs.writeFileSync(file,
            `# Chapter\nModified.\n${REVIEW_START_MARKER}\nNew content.\n${REVIEW_STOP_MARKER}\n`,
            'utf-8');

        const out = toolGetReviewText(root, {});
        expect(out).toContain('# Git diff');
        expect(out).toContain('# Review markers');
        expect(out).toContain('New content.');
    });

    it('autoStage=true removes marker lines and stages the removal', () => {
        const root = makeGitRepo();
        const file = path.join(root, 'Story', 'EN', 'Chapter 1.md');
        const body =
            `# Chapter\n` +
            `${REVIEW_START_MARKER}\n` +
            `Reviewed paragraph.\n` +
            `${REVIEW_STOP_MARKER}\n`;
        write(file, body);
        spawnSync('git', ['add', '.'], { cwd: root });
        spawnSync('git', ['commit', '-m', 'add chapter'], { cwd: root });

        toolGetReviewText(root, { autoStage: true });

        const after = fs.readFileSync(file, 'utf-8');
        expect(after).not.toContain('Bindery: Review start');
        expect(after).not.toContain('Bindery: Review stop');
        expect(after).toContain('Reviewed paragraph.');

        const staged = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf-8' });
        expect(staged.stdout).toContain('Chapter 1.md');
    });

    it('language filter excludes other-language marker regions', () => {
        const root = makeGitRepo();
        write(path.join(root, 'Story', 'EN', 'Chapter 1.md'),
            `${REVIEW_START_MARKER}\nEN region\n${REVIEW_STOP_MARKER}\n`);
        write(path.join(root, 'Story', 'NL', 'Chapter 1.md'),
            `${REVIEW_START_MARKER}\nNL region\n${REVIEW_STOP_MARKER}\n`);
        spawnSync('git', ['add', '.'], { cwd: root });
        spawnSync('git', ['commit', '-m', 'add'], { cwd: root });

        const out = toolGetReviewText(root, { language: 'NL' });
        expect(out).toContain('NL region');
        expect(out).not.toContain('EN region');
    });

    it('reports an unclosed marker as open-ended in the output', () => {
        const root = makeGitRepo();
        const file = path.join(root, 'Story', 'EN', 'Chapter 1.md');
        write(file, `${REVIEW_START_MARKER}\nOpen until EOF\nstill open\n`);
        spawnSync('git', ['add', '.'], { cwd: root });
        spawnSync('git', ['commit', '-m', 'add'], { cwd: root });

        const out = toolGetReviewText(root, {});
        expect(out).toContain('open-ended');
        expect(out).toContain('Open until EOF');
        expect(out).toContain('warning:');
    });
});
