/**
 * Unit tests for format.ts — updateTypography() pure function.
 *
 * No VS Code extension host, no commands, no file I/O.
 */

import { describe, expect, it } from 'vitest';
import { updateTypography } from '../src/format';

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
});
