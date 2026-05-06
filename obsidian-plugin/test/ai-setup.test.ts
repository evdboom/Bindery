/**
 * Obsidian Plugin — AI setup tests
 *
 * Tests AI instruction file generation from vault settings
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { setupAiFiles } from '../src/ai-setup';

describe('AI Setup', () => {
    let tempRoot: string;
    const mockApp = { vault: { getName: () => 'TestVault' } } as any;

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-aisetup-test-'));
    });

    afterEach(() => {
        if (fs.existsSync(tempRoot)) {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('should throw when settings.json does not exist', async () => {
        await expect(setupAiFiles(mockApp, tempRoot)).rejects.toThrow(/settings.json not found/);
    });

    it('should create CLAUDE.md when claude target requested', async () => {
        const settingsPath = path.join(tempRoot, '.bindery', 'settings.json');
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify({
            bookTitle: 'Test Book',
            author: 'Test Author',
        }, null, 2), 'utf-8');

        const result = await setupAiFiles(mockApp, tempRoot, ['claude'], [], false);

        expect(result.created.length).toBeGreaterThan(0);
        const claudePath = path.join(tempRoot, 'CLAUDE.md');
        expect(fs.existsSync(claudePath)).toBe(true);
    });

    it('should create copilot-instructions.md when copilot target requested', async () => {
        const settingsPath = path.join(tempRoot, '.bindery', 'settings.json');
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify({
            bookTitle: 'Test Book',
        }, null, 2), 'utf-8');

        const result = await setupAiFiles(mockApp, tempRoot, ['copilot'], [], false);

        expect(result.created.length).toBeGreaterThan(0);
        const copilotPath = path.join(tempRoot, '.github', 'copilot-instructions.md');
        expect(fs.existsSync(copilotPath)).toBe(true);
    });

    it('should create .cursor/rules when cursor target requested', async () => {
        const settingsPath = path.join(tempRoot, '.bindery', 'settings.json');
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify({
            bookTitle: 'Test Book',
        }, null, 2), 'utf-8');

        const result = await setupAiFiles(mockApp, tempRoot, ['cursor'], [], false);

        expect(result.created.length).toBeGreaterThan(0);
        const cursorPath = path.join(tempRoot, '.cursor', 'rules');
        expect(fs.existsSync(cursorPath)).toBe(true);
    });

    it('should create AGENTS.md when agents target requested', async () => {
        const settingsPath = path.join(tempRoot, '.bindery', 'settings.json');
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify({
            bookTitle: 'Test Book',
        }, null, 2), 'utf-8');

        const result = await setupAiFiles(mockApp, tempRoot, ['agents'], [], false);

        expect(result.created.length).toBeGreaterThan(0);
        const agentsPath = path.join(tempRoot, 'AGENTS.md');
        expect(fs.existsSync(agentsPath)).toBe(true);
    });

    it('should skip existing files when overwrite is false', async () => {
        const settingsPath = path.join(tempRoot, '.bindery', 'settings.json');
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify({
            bookTitle: 'Test Book',
        }, null, 2), 'utf-8');

        // Create first time
        const result1 = await setupAiFiles(mockApp, tempRoot, ['claude'], [], false);
        expect(result1.created.length).toBeGreaterThan(0);

        // Try again without overwrite
        const result2 = await setupAiFiles(mockApp, tempRoot, ['claude'], [], false);
        expect(result2.skipped.length).toBeGreaterThan(0);
    });

    it('should overwrite existing files when overwrite is true', async () => {
        const settingsPath = path.join(tempRoot, '.bindery', 'settings.json');
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify({
            bookTitle: 'Original Title',
        }, null, 2), 'utf-8');

        // Create first time
        await setupAiFiles(mockApp, tempRoot, ['claude'], [], false);
        const claudePath = path.join(tempRoot, 'CLAUDE.md');
        const original = fs.readFileSync(claudePath, 'utf-8');

        // Update settings
        fs.writeFileSync(settingsPath, JSON.stringify({
            bookTitle: 'Updated Title',
        }, null, 2), 'utf-8');

        // Regenerate with overwrite
        const result = await setupAiFiles(mockApp, tempRoot, ['claude'], [], true);
        expect(result.created.length).toBeGreaterThan(0);

        const updated = fs.readFileSync(claudePath, 'utf-8');
        expect(original).not.toBe(updated);
    });

    it('should create skill zips for requested skills', async () => {
        const settingsPath = path.join(tempRoot, '.bindery', 'settings.json');
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify({
            bookTitle: 'Test Book',
        }, null, 2), 'utf-8');

        await setupAiFiles(mockApp, tempRoot, ['claude'], ['review', 'brainstorm'], false);

        const reviewSkillPath = path.join(tempRoot, '.claude', 'skills', 'review', 'SKILL.md');
        const brainstormSkillPath = path.join(tempRoot, '.claude', 'skills', 'brainstorm', 'SKILL.md');

        expect(fs.existsSync(reviewSkillPath)).toBe(true);
        expect(fs.existsSync(brainstormSkillPath)).toBe(true);
    });

    it('should build template context from settings', async () => {
        const settingsPath = path.join(tempRoot, '.bindery', 'settings.json');
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify({
            bookTitle: 'My Epic Novel',
            author: 'Jane Doe',
            description: 'A thrilling adventure',
            genre: 'Fantasy',
            targetAudience: 'Adult',
            storyFolder: 'Story',
            languages: [
                { code: 'EN', folderName: 'EN' },
                { code: 'NL', folderName: 'NL' },
            ],
        }, null, 2), 'utf-8');

        await setupAiFiles(mockApp, tempRoot, ['agents'], [], false);

        const agentsPath = path.join(tempRoot, 'AGENTS.md');
        const content = fs.readFileSync(agentsPath, 'utf-8');

        expect(content).toContain('My Epic Novel');
        expect(content).toContain('Jane Doe');
        expect(content).toContain('A thrilling adventure');
        expect(content).toContain('Fantasy');
    });

    it('should handle missing optional settings gracefully', async () => {
        const settingsPath = path.join(tempRoot, '.bindery', 'settings.json');
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify({
            // Minimal settings
        }, null, 2), 'utf-8');

        const result = await setupAiFiles(mockApp, tempRoot, ['claude', 'copilot'], [], false);

        expect(result.created.length).toBeGreaterThan(0);
        const claudePath = path.join(tempRoot, 'CLAUDE.md');
        expect(fs.existsSync(claudePath)).toBe(true);
    });
});
