import { describe, it, expect } from 'vitest';
import { buildPandocArgs, resolveToolPath } from '../src/exporter';

// ─── resolveToolPath ──────────────────────────────────────────────────────────

describe('resolveToolPath', () => {
    it('returns the default command when override equals the default', () => {
        const result = resolveToolPath('pandoc', 'pandoc', []);
        expect(result).toBe('pandoc');
    });

    it('returns the default command when override is empty', () => {
        const result = resolveToolPath('', 'pandoc', []);
        expect(result).toBe('pandoc');
    });

    it('returns the default command when no well-known paths exist', () => {
        // All well-known paths point at non-existent paths
        const result = resolveToolPath('pandoc', 'pandoc', ['/nonexistent/path/pandoc']);
        expect(result).toBe('pandoc');
    });
});

// ─── buildPandocArgs ──────────────────────────────────────────────────────────

describe('buildPandocArgs', () => {
    it('builds basic docx args', () => {
        const args = buildPandocArgs('in.md', 'out.docx', 'docx');
        expect(args).toContain('in.md');
        expect(args).toContain('-o');
        expect(args).toContain('out.docx');
        expect(args).toContain('--to=docx');
        expect(args).toContain('--standalone');
    });

    it('builds epub args', () => {
        const args = buildPandocArgs('in.md', 'out.epub', 'epub');
        expect(args).toContain('--to=epub');
    });

    it('includes title metadata when provided', () => {
        const args = buildPandocArgs('in.md', 'out.docx', 'docx', 'My Book');
        expect(args.some(a => a.includes('title'))).toBe(true);
    });

    it('includes author metadata when provided', () => {
        const args = buildPandocArgs('in.md', 'out.docx', 'docx', undefined, 'Alice');
        expect(args.some(a => a.includes('author'))).toBe(true);
    });

    it('omits title/author metadata when not provided', () => {
        const args = buildPandocArgs('in.md', 'out.docx', 'docx');
        expect(args.some(a => a.includes('title'))).toBe(false);
        expect(args.some(a => a.includes('author'))).toBe(false);
    });

    it('builds md (markdown passthrough) args without --to flag', () => {
        const args = buildPandocArgs('in.md', 'out.md', 'md');
        // no --to= for markdown
        expect(args.some(a => a.startsWith('--to='))).toBe(false);
    });
});
