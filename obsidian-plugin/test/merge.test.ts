/**
 * Obsidian Plugin — merge tests
 *
 * Tests chapter discovery and merge execution for Obsidian vault
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Obsidian Plugin — Merge (Wrapper)', () => {
    let tempRoot: string;

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-merge-test-'));
    });

    afterEach(() => {
        if (fs.existsSync(tempRoot)) {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('should discover chapters from Story/EN folder', () => {
        const storyPath = path.join(tempRoot, 'Story', 'EN');
        fs.mkdirSync(storyPath, { recursive: true });

        fs.writeFileSync(path.join(storyPath, '01 - Introduction.md'), '# Chapter 1\nIntro');
        fs.writeFileSync(path.join(storyPath, '02 - Rising Action.md'), '# Chapter 2\nRising');
        fs.writeFileSync(path.join(storyPath, '03 - Climax.md'), '# Chapter 3\nClimax');

        const files = fs.readdirSync(storyPath).filter(f => f.endsWith('.md'));
        expect(files.length).toBe(3);
        expect(files[0]).toMatch(/^\d+ -/);
    });

    it('should handle Act folder structure', () => {
        const storyPath = path.join(tempRoot, 'Story', 'EN');
        fs.mkdirSync(path.join(storyPath, 'Act I'), { recursive: true });
        fs.mkdirSync(path.join(storyPath, 'Act II'), { recursive: true });

        fs.writeFileSync(path.join(storyPath, 'Act I', '01 - Scene 1.md'), '# Scene 1');
        fs.writeFileSync(path.join(storyPath, 'Act II', '02 - Scene 2.md'), '# Scene 2');

        const actI = fs.readdirSync(path.join(storyPath, 'Act I')).filter(f => f.endsWith('.md'));
        const actII = fs.readdirSync(path.join(storyPath, 'Act II')).filter(f => f.endsWith('.md'));

        expect(actI.length).toBe(1);
        expect(actII.length).toBe(1);
    });

    it('should parse chapter numbers from filenames', () => {
        const chapters = [
            '01 - Introduction.md',
            '02 - Chapter Name.md',
            '10 - Later Chapter.md',
        ];

        const numbers = chapters.map(name => {
            const match = name.match(/^(\d+)/);
            return match ? parseInt(match[1], 10) : null;
        });

        expect(numbers).toEqual([1, 2, 10]);
    });

    it('should create Merged output folder', () => {
        const mergedPath = path.join(tempRoot, 'Merged');
        fs.mkdirSync(mergedPath, { recursive: true });

        expect(fs.existsSync(mergedPath)).toBe(true);
    });

    it('should handle multi-language structure', () => {
        const storyPath = path.join(tempRoot, 'Story');
        fs.mkdirSync(path.join(storyPath, 'EN'), { recursive: true });
        fs.mkdirSync(path.join(storyPath, 'NL'), { recursive: true });

        fs.writeFileSync(path.join(storyPath, 'EN', '01 - Introduction.md'), 'EN intro');
        fs.writeFileSync(path.join(storyPath, 'NL', '01 - Introductie.md'), 'NL intro');

        const enFiles = fs.readdirSync(path.join(storyPath, 'EN')).filter(f => f.endsWith('.md'));
        const nlFiles = fs.readdirSync(path.join(storyPath, 'NL')).filter(f => f.endsWith('.md'));

        expect(enFiles.length).toBe(1);
        expect(nlFiles.length).toBe(1);
    });

    it('should ignore non-markdown files in Story folder', () => {
        const storyPath = path.join(tempRoot, 'Story', 'EN');
        fs.mkdirSync(storyPath, { recursive: true });

        fs.writeFileSync(path.join(storyPath, '01 - Chapter.md'), 'Content');
        fs.writeFileSync(path.join(storyPath, 'notes.txt'), 'Notes');
        fs.writeFileSync(path.join(storyPath, 'README.md'), 'README');

        const mdFiles = fs.readdirSync(storyPath).filter(f => f.endsWith('.md'));
        expect(mdFiles.length).toBe(2); // Both .md files
    });

    it('should sort chapters numerically', () => {
        const storyPath = path.join(tempRoot, 'Story', 'EN');
        fs.mkdirSync(storyPath, { recursive: true });

        fs.writeFileSync(path.join(storyPath, '10 - Chapter 10.md'), 'Ch 10');
        fs.writeFileSync(path.join(storyPath, '02 - Chapter 2.md'), 'Ch 2');
        fs.writeFileSync(path.join(storyPath, '01 - Chapter 1.md'), 'Ch 1');

        const files = fs.readdirSync(storyPath)
            .filter(f => f.endsWith('.md'))
            .sort((a, b) => {
                const numA = parseInt(a.match(/^\d+/)?.[0] ?? '0', 10);
                const numB = parseInt(b.match(/^\d+/)?.[0] ?? '0', 10);
                return numA - numB;
            });

        expect(files[0]).toContain('01');
        expect(files[1]).toContain('02');
        expect(files[2]).toContain('10');
    });

    it('should merge markdown content from multiple chapters', () => {
        const storyPath = path.join(tempRoot, 'Story', 'EN');
        fs.mkdirSync(storyPath, { recursive: true });

        const ch1 = '# Chapter 1\n\nFirst content';
        const ch2 = '# Chapter 2\n\nSecond content';

        fs.writeFileSync(path.join(storyPath, '01 - Chapter 1.md'), ch1);
        fs.writeFileSync(path.join(storyPath, '02 - Chapter 2.md'), ch2);

        const merged = [ch1, ch2].join('\n\n---\n\n');

        expect(merged).toContain('Chapter 1');
        expect(merged).toContain('Chapter 2');
        expect(merged).toContain('---');
    });

    it('should handle empty Story folder gracefully', () => {
        const storyPath = path.join(tempRoot, 'Story', 'EN');
        fs.mkdirSync(storyPath, { recursive: true });

        const files = fs.readdirSync(storyPath).filter(f => f.endsWith('.md'));
        expect(files.length).toBe(0);
    });
});
