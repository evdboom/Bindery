/**
 * One-time migration from implicit chapter images (images/chapterN.jpg,
 * prologue.jpg, epilogue.jpg — injected at merge time in older Bindery
 * versions) to explicit inline markdown image links in the chapter files.
 *
 * Pure scan/apply split: hosts (VS Code, Obsidian) own the prompt UI and
 * call `proposeLegacyImageMigration` on activation, then
 * `applyLegacyImageMigration` if the user accepts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LanguageConfig } from '@bindery/core';
import { getOrderedFiles } from './merge.js';
import { legacyImageName, hasImageLink } from './images.js';

const HEADING_LINE_RE = /^#[^\n]*\n/m;

export interface LegacyImageProposal {
    /** Absolute path of the chapter/prologue/epilogue markdown file. */
    filePath: string;
    /** Absolute path of the legacy image that is not referenced by the file. */
    imagePath: string;
    /** Relative image link (forward slashes) to insert, resolvable from the file's folder. */
    relativeLink: string;
}

/**
 * Scan one language folder for legacy images that exist on disk but are not
 * referenced by an inline image link in the corresponding markdown file.
 * Returns one proposal per affected file; empty array means nothing to migrate.
 */
export function proposeLegacyImageMigration(
    root: string,
    storyFolder: string,
    language: LanguageConfig
): LegacyImageProposal[] {
    const langPath = path.join(root, storyFolder, language.folderName);
    if (!fs.existsSync(langPath)) { return []; }

    const proposals: LegacyImageProposal[] = [];

    for (const file of getOrderedFiles(langPath, language)) {
        const kind = file.fileType.kind;
        if (kind === 'act') { continue; }

        const name = legacyImageName(kind, kind === 'chapter' ? file.fileType.num : undefined);
        const imagePath = path.join(root, 'images', name);
        if (!fs.existsSync(imagePath)) { continue; }

        const content = fs.readFileSync(file.filePath, 'utf-8');
        if (hasImageLink(content)) { continue; }

        const relativeLink = path
            .relative(path.dirname(file.filePath), imagePath)
            .replaceAll('\\', '/');
        proposals.push({ filePath: file.filePath, imagePath, relativeLink });
    }

    return proposals;
}

/**
 * Insert `![](relativeLink)` after the first heading of each proposed file
 * (or at the top when the file has no heading). Skips files that gained an
 * image link since the scan. Returns the number of files changed.
 */
export function applyLegacyImageMigration(proposals: LegacyImageProposal[]): number {
    let changed = 0;

    for (const proposal of proposals) {
        if (!fs.existsSync(proposal.filePath)) { continue; }
        const content = fs.readFileSync(proposal.filePath, 'utf-8');
        if (hasImageLink(content)) { continue; }

        const m = HEADING_LINE_RE.exec(content);
        const updated = m
            ? content.substring(0, m.index + m[0].length) + `\n![](${proposal.relativeLink})\n` + content.substring(m.index + m[0].length)
            : `![](${proposal.relativeLink})\n\n` + content;

        fs.writeFileSync(proposal.filePath, updated, 'utf-8');
        changed++;
    }

    return changed;
}

// ─── Legacy cover.jpg migration ─────────────────────────────────────────────
//
// Older Bindery versions relied on a fixed `<storyFolder>/<langFolder>/cover.jpg`
// convention. Covers are book-level metadata (epub cover flag, docx/pdf front
// page) rather than chapter content, so they migrate into the shared images/
// folder as `<code>-cover.jpg` and become an explicit `coverImage` setting
// instead of a second filename convention.

export interface LegacyCoverProposal {
    languageCode: string;
    /** Absolute path of the legacy cover.jpg file. */
    oldPath: string;
    /** New location relative to the book root, forward slashes (e.g. "images/EN-cover.jpg"). */
    newRelativePath: string;
}

/**
 * Scan configured languages for a legacy `<storyFolder>/<langFolder>/cover.jpg`
 * where `coverImage` is not already set in settings. Reuses the same single
 * activation scan as `proposeLegacyImageMigration` — callers should present
 * both proposal lists in one combined prompt rather than scanning twice.
 */
export function proposeLegacyCoverMigration(
    root: string,
    storyFolder: string,
    languages: LanguageConfig[]
): LegacyCoverProposal[] {
    const proposals: LegacyCoverProposal[] = [];

    for (const lang of languages) {
        if (lang.coverImage?.trim()) { continue; }

        const oldPath = path.join(root, storyFolder, lang.folderName, 'cover.jpg');
        if (!fs.existsSync(oldPath)) { continue; }

        proposals.push({
            languageCode: lang.code,
            oldPath,
            newRelativePath: `images/${lang.code}-cover.jpg`,
        });
    }

    return proposals;
}

/**
 * Moves each proposed cover into the shared images/ folder. Does not
 * overwrite an existing destination file. Returns the new relative path per
 * language code so the caller can merge it into `languages[].coverImage`
 * and write settings.json once.
 */
export function applyLegacyCoverMigration(root: string, proposals: LegacyCoverProposal[]): Map<string, string> {
    const applied = new Map<string, string>();

    for (const proposal of proposals) {
        if (!fs.existsSync(proposal.oldPath)) { continue; }
        const destPath = path.join(root, proposal.newRelativePath);
        if (fs.existsSync(destPath)) { continue; }

        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        try {
            fs.renameSync(proposal.oldPath, destPath);
        } catch {
            fs.copyFileSync(proposal.oldPath, destPath);
            fs.unlinkSync(proposal.oldPath);
        }
        applied.set(proposal.languageCode, proposal.newRelativePath);
    }

    return applied;
}
