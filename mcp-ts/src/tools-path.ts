/**
 * Path-safety helpers shared across MCP tool domains.
 *
 * Extracted from tools.ts so domain modules (e.g. tools-translations.ts) can
 * validate workspace-relative paths without duplicating the logic. These are
 * the single source of truth for "stay inside the workspace" checks.
 */

import * as path from 'node:path';

export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeRelativeInputPath(value: string): string {
    return value.replace(/\\/g, '/').trim();
}

export function resolvePathInside(baseDir: string, relativePath: string): string | null {
    const normalized = path.posix.normalize(normalizeRelativeInputPath(relativePath));
    if (
        !normalized
        || normalized === '.'
        || normalized === '..'
        || path.posix.isAbsolute(normalized)
        || /^[a-zA-Z]:/.test(normalized)
        || normalized.startsWith('../')
    ) {
        return null;
    }
    const resolved = path.resolve(baseDir, normalized);
    const rel = path.relative(baseDir, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) { return null; }
    return resolved;
}

export function resolveWorkspacePath(root: string, relativePath: string): string | null {
    return resolvePathInside(path.resolve(root), relativePath);
}

export function normalizeFolderName(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '.' || trimmed === '..' || /[\\/]/.test(trimmed)) {
        return null;
    }
    return trimmed;
}

export function validateSettingsPathValue(name: string, value: unknown, options: { allowNested?: boolean } = {}): string | null {
    if (value === undefined) { return null; }
    if (typeof value !== 'string') { return `Invalid ${name}: expected a string path.`; }
    const normalized = normalizeRelativeInputPath(value);
    if (!normalized) { return `Invalid ${name}: path cannot be empty.`; }
    if (options.allowNested === false) {
        if (!normalizeFolderName(normalized)) {
            return `Invalid ${name}: must be a single relative folder name inside the workspace.`;
        }
        return null;
    }
    if (!resolveWorkspacePath('/', normalized)) {
        return `Invalid ${name}: must stay inside the workspace.`;
    }
    return null;
}

export function validateWorkspaceSettingsPaths(settings: Record<string, unknown>): string | null {
    const validations: Array<[string, unknown, { allowNested?: boolean }?]> = [
        ['storyFolder', settings['storyFolder']],
        ['notesFolder', settings['notesFolder']],
        ['arcFolder', settings['arcFolder']],
        ['charactersFolder', settings['charactersFolder']],
        ['sessionFile', settings['sessionFile']],
        ['preferencesFile', settings['preferencesFile']],
        ['mergedOutputDir', settings['mergedOutputDir']],
        ['coverImage', settings['coverImage']],
    ];

    for (const [name, value, options] of validations) {
        const error = validateSettingsPathValue(name, value, options);
        if (error) { return error; }
    }

    const languages = settings['languages'];
    if (languages !== undefined) {
        if (!Array.isArray(languages)) {
            return 'Invalid languages: expected an array.';
        }
        for (let i = 0; i < languages.length; i++) {
            const entry = languages[i];
            if (!isPlainObject(entry)) {
                return `Invalid languages[${i}]: expected an object.`;
            }
            const folderError = validateSettingsPathValue(`languages[${i}].folderName`, entry['folderName'], { allowNested: false });
            if (folderError) { return folderError; }
            const coverError = validateSettingsPathValue(`languages[${i}].coverImage`, entry['coverImage']);
            if (coverError) { return coverError; }
        }
    }

    return null;
}
