/**
 * Unit tests for legacy-images.ts — migration from implicit chapterN.jpg
 * images to explicit inline markdown links.
 */

import * as fs   from 'node:fs';
import * as os   from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    proposeLegacyImageMigration, applyLegacyImageMigration,
    proposeLegacyCoverMigration, applyLegacyCoverMigration,
} from '../src/legacy-images';
import type { LanguageConfig } from '@bindery/core';

const tempRoots: string[] = [];

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-legacy-test-'));
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

function scaffold(root: string): { ch1: string; prologue: string } {
    const prologue = path.join(root, 'Story', 'EN', 'Prologue.md');
    const ch1 = path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md');
    write(prologue, '# Prologue\n\nOnce upon a time.\n');
    write(ch1, '# The Beginning\n\nIt began.\n');
    return { ch1, prologue };
}

describe('proposeLegacyImageMigration()', () => {
    it('proposes links for legacy images that are not referenced', () => {
        const root = makeRoot();
        const { ch1 } = scaffold(root);
        write(path.join(root, 'images', 'chapter1.jpg'), 'jpg');
        write(path.join(root, 'images', 'prologue.jpg'), 'jpg');

        const proposals = proposeLegacyImageMigration(root, 'Story', EN);

        expect(proposals).toHaveLength(2);
        const ch1Proposal = proposals.find(p => p.filePath === ch1);
        expect(ch1Proposal).toBeDefined();
        expect(ch1Proposal!.relativeLink).toBe('../../../images/chapter1.jpg');
        const prologueProposal = proposals.find(p => p.filePath !== ch1);
        expect(prologueProposal!.relativeLink).toBe('../../images/prologue.jpg');
    });

    it('skips files that already contain an image link', () => {
        const root = makeRoot();
        const { ch1 } = scaffold(root);
        write(ch1, '# The Beginning\n\n![](../../../images/chapter1.jpg)\n\nIt began.\n');
        write(path.join(root, 'images', 'chapter1.jpg'), 'jpg');

        expect(proposeLegacyImageMigration(root, 'Story', EN)).toEqual([]);
    });

    it('returns empty for a missing language folder or missing images', () => {
        const root = makeRoot();
        expect(proposeLegacyImageMigration(root, 'Story', EN)).toEqual([]);
        scaffold(root);
        expect(proposeLegacyImageMigration(root, 'Story', EN)).toEqual([]);
    });
});

describe('applyLegacyImageMigration()', () => {
    it('inserts the link after the first heading', () => {
        const root = makeRoot();
        const { ch1 } = scaffold(root);
        write(path.join(root, 'images', 'chapter1.jpg'), 'jpg');

        const proposals = proposeLegacyImageMigration(root, 'Story', EN);
        const changed = applyLegacyImageMigration(proposals);

        expect(changed).toBe(1);
        const content = fs.readFileSync(ch1, 'utf-8');
        expect(content).toBe('# The Beginning\n\n![](../../../images/chapter1.jpg)\n\nIt began.\n');
    });

    it('prepends when the file has no heading', () => {
        const root = makeRoot();
        const ch1 = path.join(root, 'Story', 'EN', 'Act I', 'Chapter 1.md');
        write(ch1, 'No heading here.\n');
        write(path.join(root, 'images', 'chapter1.jpg'), 'jpg');

        const proposals = proposeLegacyImageMigration(root, 'Story', EN);
        applyLegacyImageMigration(proposals);

        expect(fs.readFileSync(ch1, 'utf-8')).toBe('![](../../../images/chapter1.jpg)\n\nNo heading here.\n');
    });

    it('skips files that gained an image link between scan and apply', () => {
        const root = makeRoot();
        const { ch1 } = scaffold(root);
        write(path.join(root, 'images', 'chapter1.jpg'), 'jpg');

        const proposals = proposeLegacyImageMigration(root, 'Story', EN);
        write(ch1, '# The Beginning\n\n![](other.png)\n');

        expect(applyLegacyImageMigration(proposals)).toBe(0);
        expect(fs.readFileSync(ch1, 'utf-8')).toContain('other.png');
    });
});

describe('proposeLegacyCoverMigration()', () => {
    it('proposes moving a legacy cover.jpg into images/<code>-cover.jpg', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'cover.jpg'), 'jpg');

        const proposals = proposeLegacyCoverMigration(root, 'Story', [EN]);

        expect(proposals).toEqual([{
            languageCode: 'EN',
            oldPath: path.join(root, 'Story', 'EN', 'cover.jpg'),
            newRelativePath: 'images/EN-cover.jpg',
        }]);
    });

    it('skips a language that already has coverImage set', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'cover.jpg'), 'jpg');
        const lang: LanguageConfig = { ...EN, coverImage: 'images/EN-cover.jpg' };

        expect(proposeLegacyCoverMigration(root, 'Story', [lang])).toEqual([]);
    });

    it('skips a language with no legacy cover.jpg on disk', () => {
        const root = makeRoot();
        expect(proposeLegacyCoverMigration(root, 'Story', [EN])).toEqual([]);
    });

    it('handles multiple languages independently', () => {
        const root = makeRoot();
        const NL: LanguageConfig = { ...EN, code: 'NL', folderName: 'NL' };
        write(path.join(root, 'Story', 'EN', 'cover.jpg'), 'jpg');
        write(path.join(root, 'Story', 'NL', 'cover.jpg'), 'jpg');

        const proposals = proposeLegacyCoverMigration(root, 'Story', [EN, NL]);

        expect(proposals).toHaveLength(2);
        expect(proposals.map(p => p.languageCode).sort()).toEqual(['EN', 'NL']);
    });
});

describe('applyLegacyCoverMigration()', () => {
    it('moves the file and reports the new relative path', () => {
        const root = makeRoot();
        const oldPath = path.join(root, 'Story', 'EN', 'cover.jpg');
        write(oldPath, 'jpg-bytes');

        const proposals = proposeLegacyCoverMigration(root, 'Story', [EN]);
        const applied = applyLegacyCoverMigration(root, proposals);

        expect(applied.get('EN')).toBe('images/EN-cover.jpg');
        expect(fs.existsSync(oldPath)).toBe(false);
        expect(fs.readFileSync(path.join(root, 'images', 'EN-cover.jpg'), 'utf-8')).toBe('jpg-bytes');
    });

    it('does not overwrite an existing destination file', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'cover.jpg'), 'new-content');
        write(path.join(root, 'images', 'EN-cover.jpg'), 'existing-content');

        const proposals = proposeLegacyCoverMigration(root, 'Story', [EN]);
        const applied = applyLegacyCoverMigration(root, proposals);

        expect(applied.size).toBe(0);
        expect(fs.readFileSync(path.join(root, 'images', 'EN-cover.jpg'), 'utf-8')).toBe('existing-content');
        // Source is left in place since the move was skipped.
        expect(fs.existsSync(path.join(root, 'Story', 'EN', 'cover.jpg'))).toBe(true);
    });

    it('skips a proposal whose source file no longer exists', () => {
        const root = makeRoot();
        write(path.join(root, 'Story', 'EN', 'cover.jpg'), 'jpg');
        const proposals = proposeLegacyCoverMigration(root, 'Story', [EN]);
        fs.unlinkSync(path.join(root, 'Story', 'EN', 'cover.jpg'));

        const applied = applyLegacyCoverMigration(root, proposals);

        expect(applied.size).toBe(0);
    });
});
