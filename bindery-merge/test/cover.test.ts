/**
 * Unit tests for resolveCoverImage() — explicit settings-based cover
 * resolution with a legacy-convention fallback.
 */

import * as fs   from 'node:fs';
import * as os   from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveCoverImage, type MergeOptions } from '../src/merge';
import type { LanguageConfig } from '@bindery/core';

const tempRoots: string[] = [];

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-cover-test-'));
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

function makeOptions(root: string, language: LanguageConfig, bookCoverImage?: string): MergeOptions {
    return {
        root,
        storyFolder:      'Story',
        language,
        outputTypes:      ['md'],
        includeToc:       false,
        includeSeparators: false,
        outputDir:        'Merged',
        filePrefix:       'Book',
        pandocPath:       'pandoc',
        coverImage:       bookCoverImage,
    };
}

describe('resolveCoverImage()', () => {
    it('uses the explicit coverImage setting when the file exists', () => {
        const root = makeRoot();
        write(path.join(root, 'images', 'EN-cover.jpg'), 'jpg');
        const lang: LanguageConfig = { ...EN, coverImage: 'images/EN-cover.jpg' };

        const result = resolveCoverImage(makeOptions(root, lang));

        expect(result.coverPath).toBe(path.join(root, 'images', 'EN-cover.jpg'));
        expect(result.warning).toBeUndefined();
    });

    it('warns without a coverPath when the configured file is missing', () => {
        const root = makeRoot();
        const lang: LanguageConfig = { ...EN, coverImage: 'images/EN-cover.jpg' };

        const result = resolveCoverImage(makeOptions(root, lang));

        expect(result.coverPath).toBeUndefined();
        expect(result.warning).toContain('EN');
        expect(result.warning).toContain('images/EN-cover.jpg');
    });

    it('falls back to the legacy Story/<lang>/cover.jpg convention with a warning', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'cover.jpg'), 'jpg');

        const result = resolveCoverImage(makeOptions(root, EN));

        expect(result.coverPath).toBe(path.join(root, 'Story', 'EN', 'cover.jpg'));
        expect(result.warning).toContain('legacy');
        expect(result.warning).toContain('coverImage');
        expect(result.warning).toContain('images/EN-cover.jpg');
    });

    it('prefers the explicit setting over a legacy file that also exists', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'cover.jpg'), 'legacy');
        write(path.join(root, 'images', 'EN-cover.jpg'), 'explicit');
        const lang: LanguageConfig = { ...EN, coverImage: 'images/EN-cover.jpg' };

        const result = resolveCoverImage(makeOptions(root, lang));

        expect(result.coverPath).toBe(path.join(root, 'images', 'EN-cover.jpg'));
        expect(result.warning).toBeUndefined();
    });

    it('returns neither coverPath nor warning when no cover exists anywhere', () => {
        const root = makeRoot();

        const result = resolveCoverImage(makeOptions(root, EN));

        expect(result.coverPath).toBeUndefined();
        expect(result.warning).toBeUndefined();
    });

    // ─── Book-level fallback ──────────────────────────────────────────────────

    it('falls back to the book-level coverImage when the language has none', () => {
        const root = makeRoot();
        write(path.join(root, 'images', 'cover.jpg'), 'book-cover');

        const result = resolveCoverImage(makeOptions(root, EN, 'images/cover.jpg'));

        expect(result.coverPath).toBe(path.join(root, 'images', 'cover.jpg'));
        expect(result.warning).toBeUndefined();
    });

    it('prefers a per-language coverImage over the book-level fallback', () => {
        const root = makeRoot();
        write(path.join(root, 'images', 'cover.jpg'), 'book-cover');
        write(path.join(root, 'images', 'EN-cover.jpg'), 'lang-cover');
        const lang: LanguageConfig = { ...EN, coverImage: 'images/EN-cover.jpg' };

        const result = resolveCoverImage(makeOptions(root, lang, 'images/cover.jpg'));

        expect(result.coverPath).toBe(path.join(root, 'images', 'EN-cover.jpg'));
    });

    it('warns without a coverPath when the book-level file is missing', () => {
        const root = makeRoot();

        const result = resolveCoverImage(makeOptions(root, EN, 'images/cover.jpg'));

        expect(result.coverPath).toBeUndefined();
        expect(result.warning).toContain('book-level');
        expect(result.warning).toContain('images/cover.jpg');
    });

    it('does not fall through to the legacy convention when the book-level setting is configured but missing', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'cover.jpg'), 'legacy');

        const result = resolveCoverImage(makeOptions(root, EN, 'images/cover.jpg'));

        // A configured-but-missing setting is a warning, not silently replaced by the legacy fallback.
        expect(result.coverPath).toBeUndefined();
        expect(result.warning).toContain('book-level');
    });
});
