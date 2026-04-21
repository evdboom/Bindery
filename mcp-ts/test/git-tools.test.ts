import * as fs from 'node:fs';
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest';

import {
    toolGetReviewText,
    toolUpdateWorkspace,
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

function git(root: string, args: string[]) {
    return spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
}

function currentBranch(root: string): string {
    return git(root, ['branch', '--show-current']).stdout.trim();
}

function makeBareRemote(): string {
    const root = makeRoot();
    spawnSync('git', ['init', '--bare'], { cwd: root });
    return root;
}

function addOriginAndPush(root: string, remotePath: string): string {
    const branch = currentBranch(root);
    git(root, ['remote', 'add', 'origin', remotePath]);
    git(root, ['push', '-u', 'origin', branch]);
    return branch;
}

function cloneRepo(remotePath: string): string {
    const root = makeRoot();
    fs.rmSync(root, { recursive: true, force: true });
    spawnSync('git', ['clone', remotePath, root], { encoding: 'utf-8' });
    git(root, ['config', 'user.email', 'test@bindery.test']);
    git(root, ['config', 'user.name', 'Bindery Test']);
    return root;
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

    it('pushes the snapshot and remembers push defaults when requested', () => {
        const root = makeGitRepo();
        const remote = makeBareRemote();
        const branch = addOriginAndPush(root, remote);
        write(path.join(root, '.bindery', 'settings.json'), '{}\n');
        write(path.join(root, 'Story', 'EN', 'Chapter 1.md'), '# Ch1\nNew content.\n');

        const result = toolGitSnapshot(root, { push: true, rememberPushDefaults: true });

        expect(result).toContain(`Pushed snapshot to origin/${branch}.`);
        expect(result).toContain('Saved snapshot push defaults');

        const settings = JSON.parse(fs.readFileSync(path.join(root, '.bindery', 'settings.json'), 'utf-8')) as {
            git?: { snapshot?: { pushDefault?: boolean; remote?: string; branch?: string } };
        };
        expect(settings.git?.snapshot?.pushDefault).toBe(true);
        expect(settings.git?.snapshot?.remote).toBe('origin');
        expect(settings.git?.snapshot?.branch).toBe(branch);

        const localHead = git(root, ['rev-parse', 'HEAD']).stdout.trim();
        const remoteHead = spawnSync('git', ['ls-remote', remote, `refs/heads/${branch}`], { encoding: 'utf-8' }).stdout.split('\t')[0]?.trim();
        expect(remoteHead).toBe(localHead);
    });

    it('keeps the local snapshot when push is requested but no remote exists', () => {
        const root = makeGitRepo();
        write(path.join(root, 'Story', 'EN', 'Chapter 1.md'), '# Ch1\nNew content.\n');

        const result = toolGitSnapshot(root, { push: true });

        expect(result).toContain('Snapshot saved:');
        expect(result).toContain('Push skipped: no git remote is configured.');
    });

    it('remembers push defaults without persisting null remote/branch values', () => {
        const root = makeGitRepo();
        write(path.join(root, '.bindery', 'settings.json'), '{}\n');
        write(path.join(root, 'Story', 'EN', 'Chapter 1.md'), '# Ch1\nNew content.\n');

        const result = toolGitSnapshot(root, { push: true, rememberPushDefaults: true });

        expect(result).toContain('Saved snapshot push defaults');

        const settings = JSON.parse(fs.readFileSync(path.join(root, '.bindery', 'settings.json'), 'utf-8')) as {
            git?: { snapshot?: { pushDefault?: boolean; remote?: string; branch?: string } };
        };
        expect(settings.git?.snapshot?.pushDefault).toBe(true);
        expect(settings.git?.snapshot).not.toHaveProperty('remote');
        expect(settings.git?.snapshot?.branch).toBe(currentBranch(root));
    });

    it('reports when push defaults could not be saved because settings.json is missing', () => {
        const root = makeGitRepo();
        write(path.join(root, 'Story', 'EN', 'Chapter 1.md'), '# Ch1\nNew content.\n');

        const result = toolGitSnapshot(root, { rememberPushDefaults: true });

        expect(result).toContain('Could not save snapshot push defaults: .bindery/settings.json was not found.');
    });
});

describe('toolUpdateWorkspace', () => {
    it('fails clearly when no remote is configured', () => {
        const root = makeGitRepo();

        const result = toolUpdateWorkspace(root, {});

        expect(result).toContain('no git remote is configured');
    });

    it('pulls remote changes into the current branch', () => {
        const source = makeGitRepo();
        const remote = makeBareRemote();
        const branch = addOriginAndPush(source, remote);
        const clone = cloneRepo(remote);

        write(path.join(source, 'Story', 'EN', 'Chapter 1.md'), '# Ch1\nRemote update.\n');
        git(source, ['add', '.']);
        git(source, ['commit', '-m', 'Remote update']);
        git(source, ['push', 'origin', branch]);

        const result = toolUpdateWorkspace(clone, {});

        expect(fs.readFileSync(path.join(clone, 'Story', 'EN', 'Chapter 1.md'), 'utf-8')).toContain('Remote update.');
        expect(result).toContain(`Current branch ${branch} matches the remote default branch.`);
    });

    it('reports when the current branch differs from the remote default branch', () => {
        const source = makeGitRepo();
        const remote = makeBareRemote();
        const defaultBranch = addOriginAndPush(source, remote);

        git(source, ['switch', '-c', 'feature']);
        write(path.join(source, 'Story', 'EN', 'Feature.md'), '# Feature\nBranch content.\n');
        git(source, ['add', '.']);
        git(source, ['commit', '-m', 'Feature branch']);
        git(source, ['push', '-u', 'origin', 'feature']);

        const clone = cloneRepo(remote);
        git(clone, ['switch', 'feature']);

        const result = toolUpdateWorkspace(clone, {});

        expect(result).toContain('Current branch feature differs from remote default branch');
        expect(result).toContain(defaultBranch);
    });

    it('fails with guidance when the current branch has no upstream', () => {
        const source = makeGitRepo();
        const remote = makeBareRemote();
        const defaultBranch = addOriginAndPush(source, remote);
        const clone = cloneRepo(remote);
        git(clone, ['switch', '-c', 'feature']);

        const result = toolUpdateWorkspace(clone, {});

        expect(result).toContain('has no upstream tracking branch');
        expect(result).toContain(defaultBranch);
    });

    it('auto-stashes local changes before pulling and restores them afterwards', () => {
        const source = makeGitRepo();
        const remote = makeBareRemote();
        const branch = addOriginAndPush(source, remote);
        const clone = cloneRepo(remote);

        write(path.join(source, 'Story', 'EN', 'Chapter 1.md'), '# Ch1\nRemote update.\n');
        git(source, ['add', '.']);
        git(source, ['commit', '-m', 'Remote update']);
        git(source, ['push', 'origin', branch]);

        write(path.join(clone, 'Notes', 'local.md'), 'Keep this local note.\n');

        const result = toolUpdateWorkspace(clone, {});

        expect(fs.existsSync(path.join(clone, 'Notes', 'local.md'))).toBe(true);
        expect(fs.readFileSync(path.join(clone, 'Story', 'EN', 'Chapter 1.md'), 'utf-8')).toContain('Remote update.');
        expect(result).not.toContain('restoring stashed changes needs attention');
    });
});
