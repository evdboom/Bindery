/**
 * Integration tests: inline images through the full mergeBook() 'md' flow.
 * Does NOT invoke pandoc.
 */

import * as fs   from 'node:fs';
import * as os   from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mergeBook, type MergeOptions } from '../src/merge';
import type { LanguageConfig } from '@bindery/core';

const tempRoots: string[] = [];

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-merge-img-test-'));
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

const EN: LanguageConfig = {
    code:          'EN',
    folderName:    'EN',
    chapterWord:   'Chapter',
    actPrefix:     'Act',
    prologueLabel: 'Prologue',
    epilogueLabel: 'Epilogue',
};

function makeOptions(root: string, overrides: Partial<MergeOptions> = {}): MergeOptions {
    return {
        root,
        storyFolder:      'Story',
        language:         EN,
        outputTypes:      ['md'],
        includeToc:       false,
        includeSeparators: false,
        outputDir:        'Merged',
        filePrefix:       'Book',
        pandocPath:       'pandoc',
        ...overrides,
    };
}

describe('mergeBook() with inline images (md output)', () => {
    it('copies referenced images to Merged/Images and rewrites links relative', async () => {
        const root = makeRoot();
        write(path.join(root, 'Images', 'map.png'), 'png-bytes');
        write(
            path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'),
            '# Ch1\n\nSee the map:\n\n![World map](../../../Images/map.png)\n'
        );

        const result = await mergeBook(makeOptions(root));

        const merged = fs.readFileSync(result.outputs[0], 'utf-8');
        expect(merged).toContain('![World map](Images/map.png)');
        expect(fs.readFileSync(path.join(root, 'Merged', 'Images', 'map.png'), 'utf-8')).toBe('png-bytes');
        expect(result.warnings).toEqual([]);
    });

    it('reports missing images and stripped wikilinks as warnings, once per file', async () => {
        const root = makeRoot();
        write(
            path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'),
            '# Ch1\n\n![](../missing.png)\n\n![[obsidian-embed.png]]\n'
        );

        const result = await mergeBook(makeOptions(root));

        expect(result.warnings.filter(w => w.includes('missing.png'))).toHaveLength(1);
        expect(result.warnings.filter(w => w.includes('obsidian-embed.png'))).toHaveLength(1);
        const merged = fs.readFileSync(result.outputs[0], 'utf-8');
        expect(merged).not.toContain('![[');
    });

    it('warns about orphaned legacy chapter images instead of injecting them', async () => {
        const root = makeRoot();
        write(path.join(root, 'images', 'chapter1.jpg'), 'jpg');
        write(path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'), '# Ch1\n\nText.\n');

        const result = await mergeBook(makeOptions(root));

        const merged = fs.readFileSync(result.outputs[0], 'utf-8');
        expect(merged).not.toContain('chapter1.jpg');
        expect(result.warnings.some(w => w.includes('images/chapter1.jpg') && w.includes('no image link'))).toBe(true);
    });

    it('does not warn when the chapter references the legacy image explicitly', async () => {
        const root = makeRoot();
        write(path.join(root, 'images', 'chapter1.jpg'), 'jpg');
        write(
            path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md'),
            '# Ch1\n\n![](../../../images/chapter1.jpg)\n\nText.\n'
        );

        const result = await mergeBook(makeOptions(root));

        expect(result.warnings).toEqual([]);
        const merged = fs.readFileSync(result.outputs[0], 'utf-8');
        expect(merged).toContain('![](Images/chapter1.jpg)');
    });
});
