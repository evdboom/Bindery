import * as fs from 'node:fs';
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest';

import {
    toolGetReviewText,
    toolGitSnapshot,
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

/** Initialize a real git repository with an initial empty commit. */
function makeGitRepo(): string {
    const root = makeRoot();
    spawnSync('git', ['init'], { cwd: root });
    spawnSync('git', ['config', 'user.email', 'test@bindery.test'], { cwd: root });
    spawnSync('git', ['config', 'user.name', 'Bindery Test'], { cwd: root });
    spawnSync('git', ['commit', '--allow-empty', '-m', 'Initial commit'], { cwd: root });
    return root;
}

afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// ─── toolGetReviewText ────────────────────────────────────────────────────────

describe('toolGetReviewText', () => {
    it('returns "No uncommitted changes." for a non-git directory', () => {
        const root = makeRoot();
        const result = toolGetReviewText(root, {});
        expect(result).toBe('No uncommitted changes.');
    });

    it('returns "No uncommitted changes." for a clean git repo', () => {
        const root = makeGitRepo();
        const result = toolGetReviewText(root, {});
        expect(result).toBe('No uncommitted changes.');
    });

    it('returns diff text when there are unstaged changes', () => {
        const root = makeGitRepo();

        // Create a tracked file with initial content and commit it
        write(path.join(root, 'Story', 'EN', 'Chapter 1.md'), '# Chapter\nOriginal text.\n');
        spawnSync('git', ['add', '.'], { cwd: root });
        spawnSync('git', ['commit', '-m', 'Add chapter'], { cwd: root });

        // Modify the file to produce an unstaged diff
        fs.writeFileSync(path.join(root, 'Story', 'EN', 'Chapter 1.md'), '# Chapter\nModified text.\n', 'utf-8');

        const result = toolGetReviewText(root, {});
        expect(result).toContain('Chapter 1.md');
        expect(result).not.toBe('No uncommitted changes.');
    });

    it('filters diff output by language (EN)', () => {
        const root = makeGitRepo();

        write(path.join(root, 'Story', 'EN', 'Chapter 1.md'), '# EN\nOriginal.\n');
        write(path.join(root, 'Story', 'NL', 'Chapter 1.md'), '# NL\nOrigineel.\n');
        spawnSync('git', ['add', '.'], { cwd: root });
        spawnSync('git', ['commit', '-m', 'Add chapters'], { cwd: root });

        fs.writeFileSync(path.join(root, 'Story', 'EN', 'Chapter 1.md'), '# EN\nModified.\n', 'utf-8');
        fs.writeFileSync(path.join(root, 'Story', 'NL', 'Chapter 1.md'), '# NL\nGewijzigd.\n', 'utf-8');

        const result = toolGetReviewText(root, { language: 'EN' });
        expect(result).toContain('EN');
        expect(result).not.toContain('NL');
    });

    it('returns no-match message when language filter has no changes', () => {
        const root = makeGitRepo();

        write(path.join(root, 'Story', 'EN', 'Chapter 1.md'), '# EN\nOriginal.\n');
        spawnSync('git', ['add', '.'], { cwd: root });
        spawnSync('git', ['commit', '-m', 'Add chapter'], { cwd: root });

        fs.writeFileSync(path.join(root, 'Story', 'EN', 'Chapter 1.md'), '# EN\nModified.\n', 'utf-8');

        const result = toolGetReviewText(root, { language: 'FR' });
        expect(result).toContain('No uncommitted changes in FR files.');
    });

    it('autoStage=true stages files after returning diff', () => {
        const root = makeGitRepo();

        write(path.join(root, 'Story', 'EN', 'Chapter 1.md'), '# EN\nOriginal.\n');
        spawnSync('git', ['add', '.'], { cwd: root });
        spawnSync('git', ['commit', '-m', 'Add chapter'], { cwd: root });

        fs.writeFileSync(path.join(root, 'Story', 'EN', 'Chapter 1.md'), '# EN\nModified.\n', 'utf-8');

        toolGetReviewText(root, { autoStage: true });

        const staged = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf-8' });
        expect(staged.stdout.trim()).toContain('Chapter 1.md');
    });
});

// ─── toolGitSnapshot ──────────────────────────────────────────────────────────

describe('toolGitSnapshot', () => {
    it('returns "Nothing to snapshot" for a non-git dir with Story folder', () => {
        const root = makeRoot();
        fs.mkdirSync(path.join(root, 'Story'), { recursive: true });

        const result = toolGitSnapshot(root, {});
        expect(result).toBe('Nothing to snapshot — no changes in content folders.');
    });

    it('returns "No content folders found" when no Story/Notes/Arc exist', () => {
        const root = makeRoot();
        const result = toolGitSnapshot(root, {});
        expect(result).toBe('No content folders found to snapshot.');
    });

    it('returns "Nothing to snapshot" when content is committed and has no changes', () => {
        const root = makeGitRepo();

        write(path.join(root, 'Story', 'EN', 'Chapter 1.md'), '# Ch1\nContent.\n');
        spawnSync('git', ['add', '.'], { cwd: root });
        spawnSync('git', ['commit', '-m', 'Add chapter'], { cwd: root });

        const result = toolGitSnapshot(root, {});
        expect(result).toBe('Nothing to snapshot — no changes in content folders.');
    });

    it('commits a new content file and returns snapshot message', () => {
        const root = makeGitRepo();
        write(path.join(root, 'Story', 'EN', 'Chapter 1.md'), '# Ch1\nNew content.\n');

        const result = toolGitSnapshot(root, {});
        expect(result).toContain('Snapshot saved:');
        expect(result).toContain('1 file');
    });

    it('uses a default timestamp message when none is provided', () => {
        const root = makeGitRepo();
        write(path.join(root, 'Story', 'EN', 'Chapter 1.md'), '# Ch1\nNew.\n');

        const result = toolGitSnapshot(root, {});
        expect(result).toMatch(/Snapshot \d{4}-\d{2}-\d{2}/);
    });

    it('uses a custom message when provided', () => {
        const root = makeGitRepo();
        write(path.join(root, 'Story', 'EN', 'Chapter 1.md'), '# Ch1\nNew.\n');

        const result = toolGitSnapshot(root, { message: 'My custom snapshot' });
        expect(result).toContain('My custom snapshot');
    });

    it('reports multiple files in the snapshot message', () => {
        const root = makeGitRepo();
        write(path.join(root, 'Story', 'EN', 'Chapter 1.md'), '# Ch1\nContent.\n');
        write(path.join(root, 'Story', 'EN', 'Chapter 2.md'), '# Ch2\nContent.\n');

        const result = toolGitSnapshot(root, {});
        expect(result).toContain('2 files');
    });
});
