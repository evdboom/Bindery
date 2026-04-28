/**
 * Exporter — calls Pandoc (and optionally LibreOffice) to export the book.
 *
 * Mirrors the export logic in vscode-ext/src/merge.ts but uses Node's
 * child_process.execFile directly (no VS Code task API).
 *
 * Pandoc path resolution order:
 *   1. Plugin setting override (if set and non-default)
 *   2. Well-known install locations (same list as vscode-ext)
 *   3. PATH (passed as pandoc/libreoffice command — let the OS resolve)
 */

import { execFile } from 'node:child_process';
import * as fs   from 'node:fs';
import * as path from 'node:path';
import { readWorkspaceSettings } from '@bindery/core';
import type { App }             from './obsidian-types';
import type { BinderySettings, ExportFormat } from './settings-tab';

// ─── Well-known install paths (mirrors vscode-ext/src/tool-locate.ts) ────────

const PANDOC_WELL_KNOWN: string[] = process.platform === 'win32'
    ? [
        path.join(process.env['LOCALAPPDATA'] ?? '', 'Pandoc', 'pandoc.exe'),
        path.join(process.env['ProgramFiles']  ?? '', 'Pandoc', 'pandoc.exe'),
    ]
    : process.platform === 'darwin'
    ? [
        '/usr/local/bin/pandoc',
        '/opt/homebrew/bin/pandoc',
    ]
    : [
        '/usr/bin/pandoc',
        '/usr/local/bin/pandoc',
    ];

const LIBREOFFICE_WELL_KNOWN: string[] = process.platform === 'win32'
    ? [
        path.join(process.env['ProgramFiles'] ?? '', 'LibreOffice', 'program', 'soffice.exe'),
    ]
    : process.platform === 'darwin'
    ? [
        '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    ]
    : [
        '/usr/bin/libreoffice',
        '/usr/bin/soffice',
    ];

// ─── Path resolution ──────────────────────────────────────────────────────────

/**
 * Resolve the effective path to a tool binary.
 *
 * Priority:
 *   1. Override path (from plugin settings) if the file exists.
 *   2. Well-known install locations.
 *   3. Falls back to the default command name (let PATH resolve it).
 */
export function resolveToolPath(override: string, defaultCmd: string, wellKnown: string[]): string {
    if (override && override !== defaultCmd && fs.existsSync(override)) {
        return override;
    }
    for (const p of wellKnown) {
        if (fs.existsSync(p)) { return p; }
    }
    return defaultCmd;
}

export function resolvePandocPath(settings: BinderySettings): string {
    return resolveToolPath(settings.pandocPath, 'pandoc', PANDOC_WELL_KNOWN);
}

export function resolveLibreOfficePath(settings: BinderySettings): string {
    return resolveToolPath(settings.libreOfficePath, 'libreoffice', LIBREOFFICE_WELL_KNOWN);
}

// ─── Pandoc arg builders ──────────────────────────────────────────────────────

/**
 * Build Pandoc command-line arguments for the given format and paths.
 */
export function buildPandocArgs(
    inputFile: string,
    outputFile: string,
    format:    ExportFormat,
    title?:    string,
    author?:   string,
): string[] {
    const args: string[] = [inputFile, '-o', outputFile, '--standalone'];

    if (title)  { args.push(`--metadata=title:${title}`); }
    if (author) { args.push(`--metadata=author:${author}`); }

    if (format === 'epub') {
        args.push('--to=epub');
    } else if (format === 'docx') {
        args.push('--to=docx');
    }
    // 'md' and 'pdf' rely on Pandoc's default output format detection from extension

    return args;
}

// ─── Export orchestration ─────────────────────────────────────────────────────

function execFileAsync(cmd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, (error, _stdout, stderr) => {
            if (error) {
                reject(new Error(`${cmd} failed: ${stderr || error.message}`));
            } else {
                resolve();
            }
        });
    });
}

/**
 * Export the book to the requested format using Pandoc.
 *
 * Reads .bindery/settings.json from the vault root to get title/author metadata.
 * The merged markdown file is expected to already exist in the output directory.
 *
 * @param app       - Obsidian App instance (or test mock)
 * @param settings  - Plugin settings (tool paths, format)
 * @param format    - Export format: 'md' | 'docx' | 'epub' | 'pdf'
 */
export async function exportBook(
    app:      App,
    settings: BinderySettings,
    format:   ExportFormat,
): Promise<void> {
    const vaultPath    = app.vault.adapter!.basePath;
    const bookSettings = readWorkspaceSettings(vaultPath);

    const title  = typeof bookSettings?.bookTitle === 'string' ? bookSettings.bookTitle : undefined;
    const author = bookSettings?.author;
    const outputDir = bookSettings?.mergedOutputDir ?? 'Merged';
    const prefix    = bookSettings?.mergeFilePrefix ?? 'Book';

    const outputDirFull = path.join(vaultPath, outputDir);
    if (!fs.existsSync(outputDirFull)) {
        fs.mkdirSync(outputDirFull, { recursive: true });
    }

    // The merged markdown is the input; pandoc converts to the target format
    const inputFile  = path.join(outputDirFull, `${prefix}_Merged.md`);
    const outputFile = path.join(outputDirFull, `${prefix}_Merged.${format}`);

    if (!fs.existsSync(inputFile)) {
        throw new Error(`Merged markdown not found: ${inputFile}\nRun "Export → Markdown" first.`);
    }

    if (format === 'pdf') {
        // LibreOffice converts from DOCX → PDF
        const docxFile = path.join(outputDirFull, `${prefix}_Merged.docx`);
        if (!fs.existsSync(docxFile)) {
            // Generate DOCX first
            const pandoc = resolvePandocPath(settings);
            const docxArgs = buildPandocArgs(inputFile, docxFile, 'docx', title, author);
            await execFileAsync(pandoc, docxArgs);
        }
        const lo = resolveLibreOfficePath(settings);
        await execFileAsync(lo, [
            '--headless', '--convert-to', 'pdf',
            '--outdir', outputDirFull,
            docxFile,
        ]);
        return;
    }

    const pandoc = resolvePandocPath(settings);
    const args = buildPandocArgs(inputFile, outputFile, format, title, author);
    await execFileAsync(pandoc, args);
}
