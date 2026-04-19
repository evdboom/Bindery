import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    INDEX_FORMAT_VERSION,
    buildIndex,
    indexPath,
    loadIndex,
} from '../src/search';

const tempRoots: string[] = [];

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-index-version-'));
    tempRoots.push(root);
    return root;
}

function write(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
}

afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

describe('index format versioning', () => {
    it('stamps INDEX_FORMAT_VERSION when building', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\nHello\n');

        const built = buildIndex(root);
        expect(built.meta.indexFormatVersion).toBe(INDEX_FORMAT_VERSION);

        const raw = JSON.parse(fs.readFileSync(indexPath(root), 'utf-8'));
        expect(raw.meta.indexFormatVersion).toBe(INDEX_FORMAT_VERSION);
    });

    it('loadIndex returns null when the on-disk version is older', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\nHello\n');

        buildIndex(root);

        // Simulate a stale index from an earlier release
        const raw = JSON.parse(fs.readFileSync(indexPath(root), 'utf-8'));
        raw.meta.indexFormatVersion = INDEX_FORMAT_VERSION - 1;
        fs.writeFileSync(indexPath(root), JSON.stringify(raw), 'utf-8');

        expect(loadIndex(root)).toBeNull();
    });

    it('loadIndex returns null when version field is missing entirely', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter1.md'), '# Ch1\nHello\n');

        buildIndex(root);

        const raw = JSON.parse(fs.readFileSync(indexPath(root), 'utf-8'));
        delete raw.meta.indexFormatVersion;
        fs.writeFileSync(indexPath(root), JSON.stringify(raw), 'utf-8');

        expect(loadIndex(root)).toBeNull();
    });
});
