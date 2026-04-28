import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatFile, formatText } from '../src/formatter';
import type { TFile, Vault } from '../src/obsidian-types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFile(ext = 'md'): TFile {
    return { path: 'test.md', extension: ext, name: 'test.md', basename: 'test' };
}

function makeVault(content: string): { vault: Vault; readMock: ReturnType<typeof vi.fn>; modifyMock: ReturnType<typeof vi.fn> } {
    const readMock   = vi.fn().mockResolvedValue(content);
    const modifyMock = vi.fn().mockResolvedValue(undefined);
    const vault: Vault = {
        read:    readMock,
        modify:  modifyMock,
        getName: () => 'TestVault',
        on:      vi.fn().mockReturnValue({}),
    };
    return { vault, readMock, modifyMock };
}

// ─── formatText ───────────────────────────────────────────────────────────────

describe('formatText', () => {
    it('converts straight double quotes to curly quotes', () => {
        expect(formatText('"Hello"')).toBe('\u201CHello\u201D');
    });

    it('converts double-dash to em-dash', () => {
        expect(formatText('It was--perfect.')).toBe('It was\u2014perfect.');
    });

    it('converts ellipsis', () => {
        expect(formatText('Wait...')).toBe('Wait\u2026');
    });

    it('returns unchanged text when nothing to convert', () => {
        const input = 'Hello world.';
        expect(formatText(input)).toBe(input);
    });
});

// ─── formatFile (happy path) ──────────────────────────────────────────────────

describe('formatFile', () => {
    it('reads, formats, and writes the file when content changes', async () => {
        const { vault, readMock, modifyMock } = makeVault('"Hello"');
        const file = makeFile();

        const modified = await formatFile(vault, file);

        expect(modified).toBe(true);
        expect(readMock).toHaveBeenCalledWith(file);
        expect(modifyMock).toHaveBeenCalledWith(file, '\u201CHello\u201D');
    });

    it('returns false and does not call modify when content is unchanged', async () => {
        const alreadyFormatted = '\u201CHello\u201D';
        const { vault, modifyMock } = makeVault(alreadyFormatted);
        const file = makeFile();

        const modified = await formatFile(vault, file);

        expect(modified).toBe(false);
        expect(modifyMock).not.toHaveBeenCalled();
    });

    // ─── Non-happy paths ──────────────────────────────────────────────────────

    it('propagates read errors', async () => {
        const readMock   = vi.fn().mockRejectedValue(new Error('read failed'));
        const modifyMock = vi.fn();
        const vault: Vault = {
            read:    readMock,
            modify:  modifyMock,
            getName: () => 'TestVault',
            on:      vi.fn().mockReturnValue({}),
        };
        const file = makeFile();

        await expect(formatFile(vault, file)).rejects.toThrow('read failed');
        expect(modifyMock).not.toHaveBeenCalled();
    });

    it('propagates modify errors', async () => {
        const { vault, modifyMock } = makeVault('"Hello"');
        modifyMock.mockRejectedValue(new Error('write failed'));
        const file = makeFile();

        await expect(formatFile(vault, file)).rejects.toThrow('write failed');
    });

    it('handles empty file content', async () => {
        const { vault, modifyMock } = makeVault('');
        const file = makeFile();

        const modified = await formatFile(vault, file);

        expect(modified).toBe(false);
        expect(modifyMock).not.toHaveBeenCalled();
    });
});
