/**
 * Unit tests for formatting.ts — updateTypography() / applyTypography() pure functions.
 *
 * No VS Code extension host, no commands, no file I/O.
 */

import { describe, expect, it } from 'vitest';
import { updateTypography, applyTypography } from '../src/formatting';

describe('updateTypography()', () => {
    // ─── Edge cases ───────────────────────────────────────────────────────────

    it('empty string returns empty string', () => {
        expect(updateTypography('')).toBe('');
    });

    it('preserves newlines in multi-line input', () => {
        const input  = 'line one\nline two\nline three';
        const result = updateTypography(input);
        expect(result.split('\n')).toHaveLength(3);
        expect(result).toContain('\n');
    });

    // ─── Ellipsis ─────────────────────────────────────────────────────────────

    it('converts triple dots to ellipsis character', () => {
        expect(updateTypography('And then...')).toBe('And then\u2026');
    });

    // ─── Em-dash ──────────────────────────────────────────────────────────────

    it('converts double-dash to em-dash', () => {
        expect(updateTypography('It was--perfect.')).toBe('It was\u2014perfect.');
    });

    it('does not convert triple-dash (markdown HR)', () => {
        const input  = '---\nSome text\n---';
        const result = updateTypography(input);
        expect(result).toContain('---');
        expect(result).not.toContain('\u2014\u2014\u2014');
    });

    // ─── Double quotes ────────────────────────────────────────────────────────

    it('converts straight double quotes to curly quotes', () => {
        expect(updateTypography('"Hello"')).toBe('\u201CHello\u201D');
    });

    it('already-correct curly double quotes are not double-processed', () => {
        const input = '\u201CHello,\u201D she said.';
        expect(updateTypography(input)).toBe(input);
    });

    // ─── Single quotes / apostrophes ──────────────────────────────────────────

    it("converts apostrophe: it's → it\u2019s", () => {
        expect(updateTypography("it's")).toBe('it\u2019s');
    });

    // ─── HTML comment protection ──────────────────────────────────────────────

    it('preserves double-dash inside HTML comments (no em-dash conversion)', () => {
        const input  = '<!-- keep -- this --> "outside"';
        const result = updateTypography(input);
        // Double-dash inside the comment must survive intact
        expect(result).toContain('<!-- keep -- this -->');
        // Content outside the comment is still formatted
        expect(result).toContain('\u201Coutside\u201D');
    });

    it('does not alter HTML comment content while formatting surrounding text', () => {
        const input  = 'before <!-- comment -- here --> after--end';
        const result = updateTypography(input);
        expect(result).toContain('<!-- comment -- here -->');
        expect(result).toContain('\u2014end');
    });

    // ─── Fenced code blocks ───────────────────────────────────────────────────

    it('backtick code fence delimiters are not corrupted by any transform', () => {
        // Triple backticks are not matched by ellipsis (/\.\.\./) or em-dash (/--/) regexes
        const input  = '```typescript\nconst x = 1;\n```';
        const result = updateTypography(input);
        expect(result).toContain('```typescript');
        expect(result).toContain('```');
    });

    // ─── Mixed content ────────────────────────────────────────────────────────

    it('applies all transforms together on mixed content', () => {
        const input  = '"Wait..." she said--stepping back.';
        const result = updateTypography(input);
        expect(result).toContain('\u201C');   // opening curly double quote
        expect(result).toContain('\u201D');   // closing curly double quote
        expect(result).toContain('\u2026');   // ellipsis
        expect(result).toContain('\u2014');   // em-dash
        expect(result).not.toContain('"');
        expect(result).not.toContain('...');
        expect(result).not.toContain('--');
    });

    it('already-formatted content is returned unchanged (idempotent)', () => {
        const input = '\u201CHello,\u201D she said\u2014stepping back\u2026';
        expect(updateTypography(input)).toBe(input);
    });

    // ─── Opening quotes after various opening characters ──────────────────────

    it('opens double quote after opening parenthesis', () => {
        expect(updateTypography('("Hello")')).toContain('\u201CHello\u201D');
    });

    it('opens double quote after opening bracket', () => {
        expect(updateTypography('["Hello"]')).toContain('\u201CHello\u201D');
    });

    it('opens double quote after em-dash', () => {
        const result = updateTypography('\u2014"Hello"');
        expect(result).toContain('\u201CHello\u201D');
    });

    it('opens single quote after parenthesis', () => {
        const result = updateTypography("('test')");
        expect(result).toContain('\u2018test\u2019');
    });

    // ─── Closing double quote after em-dash ───────────────────────────────────

    it('corrects closing quote after em-dash at end of sentence', () => {
        // Input: "word--" should become "word—" (em-dash + closing quote)
        const input = 'He said "fine--"';
        const result = updateTypography(input);
        expect(result).toContain('\u2014\u201D');
    });

    it('corrects closing quote after em-dash followed by punctuation', () => {
        const input = 'He said "fine--" and left.';
        const result = updateTypography(input);
        expect(result).toContain('\u2014\u201D');
    });

    // ─── Multiple HTML comments ───────────────────────────────────────────────

    it('handles multiple HTML comments in one document', () => {
        const input = '<!-- first -- comment -->\nText--here.\n<!-- second -- comment -->';
        const result = updateTypography(input);
        expect(result).toContain('<!-- first -- comment -->');
        expect(result).toContain('<!-- second -- comment -->');
        expect(result).toContain('Text\u2014here.');
    });

    // ─── Multi-line quotes ────────────────────────────────────────────────────

    it('handles quote at start of a line', () => {
        const result = updateTypography('"Start of line."');
        expect(result).toBe('\u201CStart of line.\u201D');
    });

    // ─── No-op for content without formattable characters ─────────────────────

    it('returns plain text unchanged when no formatting is needed', () => {
        const input = 'Plain text without anything special.';
        expect(updateTypography(input)).toBe(input);
    });

    // ─── Image / link target protection ───────────────────────────────────────

    it('does not corrupt an image path containing double-dashes', () => {
        const input = '![cover](images/cover--final.png)';
        expect(updateTypography(input)).toBe(input);
    });

    it('does not corrupt quotes inside a link title', () => {
        const input = '![alt](images/map.png "The \'Old\' Map")';
        expect(updateTypography(input)).toBe(input);
    });

    it('does not touch a plain markdown link target with special chars', () => {
        const input = 'See [the doc](notes/plan--v2.md) for details.';
        const result = updateTypography(input);
        expect(result).toContain('notes/plan--v2.md');
        // surrounding prose is still formatted
        expect(result).toBe('See [the doc](notes/plan--v2.md) for details.');
    });

    it('formats alt text and surrounding prose while preserving the path', () => {
        const input = '![a map--legend](images/map.png) "quoted" text';
        const result = updateTypography(input);
        expect(result).toContain('(images/map.png)');
        expect(result).toContain('—legend');
        expect(result).toContain('“quoted”');
    });

    it('does not corrupt an Obsidian wikilink embed', () => {
        const input = 'Before ![[my "vault" pic--v2.png]] after--text';
        const result = updateTypography(input);
        expect(result).toContain('![[my "vault" pic--v2.png]]');
        expect(result).toContain('after—text');
    });

    it('does not corrupt a plain Obsidian wikilink', () => {
        const input = "See [[Notes/Plan--v2]] for it's context.";
        const result = updateTypography(input);
        expect(result).toContain('[[Notes/Plan--v2]]');
        expect(result).toContain('it’s');
    });

    it('handles multiple image links on one line independently', () => {
        const input = '![a](one--two.png) and ![b](three--four.png)';
        const result = updateTypography(input);
        expect(result).toContain('(one--two.png)');
        expect(result).toContain('(three--four.png)');
    });

    it('protects the full target when the path contains balanced parentheses', () => {
        const input = '![alt](assets/a(b)--c.png) and prose--here';
        const result = updateTypography(input);
        expect(result).toContain('(assets/a(b)--c.png)');
        expect(result).toContain('prose—here');
    });

    it('does not hang on pathological repeated wikilink openers', () => {
        const input = '[['.repeat(20000);
        const start = Date.now();
        updateTypography(input);
        expect(Date.now() - start).toBeLessThan(2000);
    });
});

describe('applyTypography()', () => {
    it('is an alias for updateTypography — same output', () => {
        const input = '"Hello..." she said--stepping back.';
        expect(applyTypography(input)).toBe(updateTypography(input));
    });

    it('empty string returns empty string', () => {
        expect(applyTypography('')).toBe('');
    });

    it('applies all transforms', () => {
        const result = applyTypography('"Test..." value--end.');
        expect(result).toContain('\u201C');
        expect(result).toContain('\u2026');
        expect(result).toContain('\u2014');
    });
});
