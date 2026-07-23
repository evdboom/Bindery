/**
 * Unit tests for images.ts — inline image link rewriting, wikilink stripping,
 * portable markdown export, and legacy image helpers.
 */

import * as fs   from 'node:fs';
import * as os   from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    rewriteImageLinks,
    makePortableMarkdown,
    legacyImageName,
    hasImageLink,
} from '../src/images';

const tempRoots: string[] = [];

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-images-test-'));
    tempRoots.push(root);
    return root;
}

function write(filePath: string, content: string | Buffer): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
}

afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// ─── rewriteImageLinks ────────────────────────────────────────────────────────

describe('rewriteImageLinks()', () => {
    it('resolves a relative link against the source directory', () => {
        const root = makeRoot();
        write(path.join(root, 'Images', 'map.png'), 'fake-png');
        const chapterDir = path.join(root, 'Story', 'EN');
        fs.mkdirSync(chapterDir, { recursive: true });

        const result = rewriteImageLinks('# Ch1\n\n![A map](../../Images/map.png)\n', chapterDir, 'ch1.md');

        const expected = path.join(root, 'Images', 'map.png').replaceAll('\\', '/');
        expect(result.content).toContain(`![A map](${expected})`);
        expect(result.warnings).toEqual([]);
        expect(result.imagePaths).toEqual([expected]);
    });

    it('keeps a title suffix intact', () => {
        const root = makeRoot();
        write(path.join(root, 'map.png'), 'fake');

        const result = rewriteImageLinks('![alt](map.png "The Map")', root, 'ch1.md');

        const expected = path.join(root, 'map.png').replaceAll('\\', '/');
        expect(result.content).toBe(`![alt](${expected} "The Map")`);
    });

    it('leaves external URLs untouched', () => {
        const content = '![remote](https://example.com/pic.png) ![data](data:image/png;base64,AAA=)';
        const result = rewriteImageLinks(content, makeRoot(), 'ch1.md');
        expect(result.content).toBe(content);
        expect(result.warnings).toEqual([]);
    });

    it('warns on a missing image but keeps the link visible', () => {
        const root = makeRoot();
        const result = rewriteImageLinks('![](nope/gone.png)', root, 'ch7.md');
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toContain('ch7.md');
        expect(result.warnings[0]).toContain('gone.png');
        expect(result.content).toContain('gone.png');
        expect(result.imagePaths).toEqual([]);
    });

    it('strips Obsidian wikilink embeds with a warning', () => {
        const result = rewriteImageLinks('Before\n![[vault-pic.png]]\nAfter', makeRoot(), 'ch2.md');
        expect(result.content).not.toContain('![[');
        expect(result.content).toContain('Before');
        expect(result.content).toContain('After');
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toContain('ch2.md');
        expect(result.warnings[0]).toContain('vault-pic.png');
    });

    it('does not touch links inside fenced code blocks', () => {
        const content = '```\n![in-fence](x.png)\n![[wiki]]\n```\n';
        const result = rewriteImageLinks(content, makeRoot(), 'ch3.md');
        expect(result.content).toBe(content);
        expect(result.warnings).toEqual([]);
    });

    it('normalizes an already-absolute path without relocating it', () => {
        const root = makeRoot();
        write(path.join(root, 'pic.png'), 'fake');
        const abs = path.join(root, 'pic.png');

        const result = rewriteImageLinks(`![](${abs.replaceAll('\\', '/')})`, path.join(root, 'elsewhere'), 'ch4.md');

        expect(result.content).toContain(abs.replaceAll('\\', '/'));
        expect(result.warnings).toEqual([]);
    });
});

// ─── makePortableMarkdown ─────────────────────────────────────────────────────

describe('makePortableMarkdown()', () => {
    it('copies absolute-path images to Images/ and rewrites links relative', () => {
        const root = makeRoot();
        const src = path.join(root, 'assets', 'map.png');
        write(src, 'png-bytes');
        const outputDir = path.join(root, 'Merged');
        fs.mkdirSync(outputDir, { recursive: true });

        const content = `![A map](${src.replaceAll('\\', '/')})`;
        const result = makePortableMarkdown(content, outputDir);

        expect(result.content).toBe('![A map](Images/map.png)');
        expect(fs.readFileSync(path.join(outputDir, 'Images', 'map.png'), 'utf-8')).toBe('png-bytes');
        expect(result.warnings).toEqual([]);
    });

    it('dedupes name collisions with numeric suffixes and reuses the same dest for the same source', () => {
        const root = makeRoot();
        const srcA = path.join(root, 'a', 'map.png');
        const srcB = path.join(root, 'b', 'map.png');
        write(srcA, 'aaa');
        write(srcB, 'bbb');
        const outputDir = path.join(root, 'Merged');
        fs.mkdirSync(outputDir, { recursive: true });

        const fa = srcA.replaceAll('\\', '/');
        const fb = srcB.replaceAll('\\', '/');
        const result = makePortableMarkdown(`![](${fa})\n![](${fb})\n![](${fa})`, outputDir);

        expect(result.content).toBe('![](Images/map.png)\n![](Images/map-2.png)\n![](Images/map.png)');
        expect(fs.readFileSync(path.join(outputDir, 'Images', 'map.png'), 'utf-8')).toBe('aaa');
        expect(fs.readFileSync(path.join(outputDir, 'Images', 'map-2.png'), 'utf-8')).toBe('bbb');
        expect(result.copied).toHaveLength(2);
    });

    it('leaves external URLs and missing files untouched', () => {
        const root = makeRoot();
        const outputDir = path.join(root, 'Merged');
        fs.mkdirSync(outputDir, { recursive: true });
        const missing = path.join(root, 'ghost.png').replaceAll('\\', '/');

        const content = `![](https://example.com/x.png)\n![](${missing})`;
        const result = makePortableMarkdown(content, outputDir);

        expect(result.content).toBe(content);
        expect(result.copied).toEqual([]);
        expect(fs.existsSync(path.join(outputDir, 'Images'))).toBe(false);
    });
});

// ─── legacy helpers ───────────────────────────────────────────────────────────

describe('legacyImageName() / hasImageLink()', () => {
    it('maps kinds to legacy image names', () => {
        expect(legacyImageName('prologue')).toBe('prologue.jpg');
        expect(legacyImageName('epilogue')).toBe('epilogue.jpg');
        expect(legacyImageName('chapter', 12)).toBe('chapter12.jpg');
    });

    it('detects image links regardless of prior regex state', () => {
        // Called twice to guard against lastIndex leakage on the shared regex.
        expect(hasImageLink('text ![x](a.png) more')).toBe(true);
        expect(hasImageLink('text ![x](a.png) more')).toBe(true);
        expect(hasImageLink('no images here, just [a link](x.md)')).toBe(false);
    });
});
