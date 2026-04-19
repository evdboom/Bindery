/**
 * Detect external tool availability (git, pandoc, libreoffice) for the MCP server.
 *
 * Mirrors the logic in vscode-ext/src/tool-locate.ts but standalone (mcp-ts is
 * packaged separately and cannot import from the extension).
 *
 * Used by bindery_health to surface tool status to agents and users.
 */

import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type ToolName = 'git' | 'pandoc' | 'libreoffice';

export interface ProbeResult {
    available: boolean;
    path: string | null;
    source: 'path' | 'default' | null;
    version: string | null;
}

function wellKnownPaths(tool: ToolName): string[] {
    const env = process.env;
    const home = env['HOME'] || env['USERPROFILE'] || '';

    if (process.platform === 'win32') {
        const programFiles = env['ProgramFiles'] || 'C:\\Program Files';
        const programFiles86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        const localAppData = env['LOCALAPPDATA'] || path.join(home, 'AppData', 'Local');

        if (tool === 'pandoc') {
            return [
                path.join(localAppData, 'Pandoc', 'pandoc.exe'),
                path.join(programFiles, 'Pandoc', 'pandoc.exe'),
                path.join(programFiles86, 'Pandoc', 'pandoc.exe'),
            ];
        }
        if (tool === 'libreoffice') {
            return [
                path.join(programFiles, 'LibreOffice', 'program', 'soffice.exe'),
                path.join(programFiles86, 'LibreOffice', 'program', 'soffice.exe'),
            ];
        }
        // git — use Git-for-Windows default
        return [
            path.join(programFiles, 'Git', 'cmd', 'git.exe'),
            path.join(programFiles86, 'Git', 'cmd', 'git.exe'),
        ];
    }

    if (process.platform === 'darwin') {
        if (tool === 'pandoc') {
            return ['/opt/homebrew/bin/pandoc', '/usr/local/bin/pandoc', '/usr/bin/pandoc'];
        }
        if (tool === 'libreoffice') {
            return [
                '/Applications/LibreOffice.app/Contents/MacOS/soffice',
                '/opt/homebrew/bin/soffice',
                '/usr/local/bin/soffice',
            ];
        }
        return ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'];
    }

    // linux
    if (tool === 'pandoc') {
        return ['/usr/bin/pandoc', '/usr/local/bin/pandoc'];
    }
    if (tool === 'libreoffice') {
        return ['/usr/bin/libreoffice', '/usr/bin/soffice', '/usr/local/bin/libreoffice'];
    }
    return ['/usr/bin/git', '/usr/local/bin/git'];
}

function defaultCommand(tool: ToolName): string {
    if (tool === 'git') { return process.platform === 'win32' ? 'git.exe' : 'git'; }
    if (tool === 'pandoc') { return process.platform === 'win32' ? 'pandoc.exe' : 'pandoc'; }
    return process.platform === 'win32' ? 'soffice.exe' : 'libreoffice';
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

function versionFlag(tool: ToolName): string {
    return '--version';
}

function extractVersion(stdout: string): string | null {
    const first = stdout.split(/\r?\n/).map(s => s.trim()).find(Boolean);
    return first || null;
}

/**
 * Probe a tool: is it available, where, what version.
 * Resolution: PATH → well-known defaults. Does NOT read VS Code settings
 * (the MCP server doesn't have access to them).
 */
export function probeTool(tool: ToolName): ProbeResult {
    const cmd = defaultCommand(tool);
    const candidates: Array<{ p: string; source: 'path' | 'default' }> = [];

    const onPath = resolveOnPath(cmd);
    if (onPath) { candidates.push({ p: onPath, source: 'path' }); }

    for (const c of wellKnownPaths(tool)) {
        if (fs.existsSync(c)) { candidates.push({ p: c, source: 'default' }); }
    }

    for (const { p, source } of candidates) {
        try {
            const res = cp.spawnSync(p, [versionFlag(tool)], { encoding: 'utf-8', timeout: 5000 });
            if (res.status === 0) {
                return { available: true, path: p, source, version: extractVersion(res.stdout) };
            }
        } catch {
            // try next candidate
        }
    }

    return { available: false, path: null, source: null, version: null };
}
