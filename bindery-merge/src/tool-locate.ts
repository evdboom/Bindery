/**
 * Auto-detect Pandoc and LibreOffice installations across platforms.
 *
 * Resolution order for each tool:
 *   1. Explicit user setting (if set to a non-default value)
 *   2. Command on PATH (via `where.exe` / `which`)
 *   3. Well-known per-OS install locations
 *   4. Fallback to command name (let PATH resolve it)
 *
 * Results are cached per-process. Call clearLocateCache() when settings change.
 */

import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type ToolName = 'pandoc' | 'libreoffice';

export interface ResolvedTool {
    path: string;
    source: 'setting' | 'path' | 'default' | 'fallback';
}

const cache = new Map<ToolName, ResolvedTool | null>();

export function clearLocateCache(): void {
    cache.clear();
}

function wellKnownPaths(tool: ToolName): string[] {
    const env = process.env;
    const home = env.HOME || env.USERPROFILE || '';

    if (process.platform === 'win32') {
        const programFiles = env['ProgramFiles'] || String.raw`C:\Program Files`;
        const programFiles86 = env['ProgramFiles(x86)'] || String.raw`C:\Program Files (x86)`;
        const localAppData = env['LOCALAPPDATA'] || path.join(home, 'AppData', 'Local');

        if (tool === 'pandoc') {
            return [
                path.join(localAppData, 'Pandoc', 'pandoc.exe'),
                path.join(programFiles, 'Pandoc', 'pandoc.exe'),
                path.join(programFiles86, 'Pandoc', 'pandoc.exe'),
            ];
        }
        return [
            path.join(programFiles, 'LibreOffice', 'program', 'soffice.com'),
            path.join(programFiles86, 'LibreOffice', 'program', 'soffice.com'),
            path.join(programFiles, 'LibreOffice', 'program', 'soffice.exe'),
            path.join(programFiles86, 'LibreOffice', 'program', 'soffice.exe'),
        ];
    }

    if (process.platform === 'darwin') {
        if (tool === 'pandoc') {
            return [
                '/opt/homebrew/bin/pandoc',
                '/usr/local/bin/pandoc',
                '/usr/bin/pandoc',
            ];
        }
        return [
            '/Applications/LibreOffice.app/Contents/MacOS/soffice',
            '/opt/homebrew/bin/soffice',
            '/usr/local/bin/soffice',
        ];
    }

    // Linux / other POSIX
    if (tool === 'pandoc') {
        return ['/usr/bin/pandoc', '/usr/local/bin/pandoc'];
    }
    return ['/usr/bin/libreoffice', '/usr/bin/soffice', '/usr/local/bin/libreoffice'];
}

function defaultCommand(tool: ToolName): string {
    if (tool === 'pandoc') { return 'pandoc'; }
    return process.platform === 'win32' ? 'soffice.com' : 'libreoffice';
}

function pathCandidates(tool: ToolName): string[] {
    if (tool === 'pandoc') { return ['pandoc']; }
    return process.platform === 'win32'
        ? ['soffice.com', 'soffice.exe', 'soffice']
        : ['libreoffice', 'soffice'];
}

function isSettingDefault(tool: ToolName, value: string | undefined): boolean {
    const v = (value ?? '').trim();
    if (v === '') { return true; }
    if (tool === 'pandoc' && v === 'pandoc') { return true; }
    if (tool === 'libreoffice' && (v === 'libreoffice' || v === 'soffice')) { return true; }
    return false;
}

function resolveOnPath(cmd: string): string | null {
    const locator = process.platform === 'win32' ? 'where.exe' : 'which';
    try {
        const result = cp.spawnSync(locator, [cmd], { encoding: 'utf-8', timeout: 5000 });
        if (result.status !== 0) { return null; }
        const first = (result.stdout || '').split(/\r?\n/).map(s => s.trim()).find(Boolean);
        return first || null;
    } catch {
        return null;
    }
}

export function locateTool(tool: ToolName, setting: string | undefined): ResolvedTool {
    const cached = cache.get(tool);
    if (cached?.source === 'setting' && (setting ?? '').trim() === cached.path) {
        return cached;
    }
    if (cached && cached.source !== 'setting' && isSettingDefault(tool, setting)) {
        return cached;
    }

    const trimmed = (setting ?? '').trim();
    if (!isSettingDefault(tool, trimmed)) {
        if (fs.existsSync(trimmed)) {
            const resolved: ResolvedTool = { path: trimmed, source: 'setting' };
            cache.set(tool, resolved);
            return resolved;
        }
        const resolved: ResolvedTool = { path: trimmed, source: 'setting' };
        cache.set(tool, resolved);
        return resolved;
    }

    for (const cmd of pathCandidates(tool)) {
        const onPath = resolveOnPath(cmd);
        if (onPath && fs.existsSync(onPath)) {
            const resolved: ResolvedTool = { path: onPath, source: 'path' };
            cache.set(tool, resolved);
            return resolved;
        }
    }

    for (const candidate of wellKnownPaths(tool)) {
        if (fs.existsSync(candidate)) {
            const resolved: ResolvedTool = { path: candidate, source: 'default' };
            cache.set(tool, resolved);
            return resolved;
        }
    }

    const fallback: ResolvedTool = { path: defaultCommand(tool), source: 'fallback' };
    cache.set(tool, fallback);
    return fallback;
}

export function locateToolPath(tool: ToolName, setting: string | undefined): string {
    return locateTool(tool, setting).path;
}
