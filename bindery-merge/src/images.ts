/**
 * Inline image handling for merged output.
 *
 * Authors write standard markdown image links (`![alt](relative/path.png)`)
 * relative to the chapter file, so host previews (VS Code, Obsidian) render
 * them. At merge time those links are resolved to absolute paths so Pandoc
 * can embed them regardless of where the merged temp file lives.
 *
 * Obsidian wikilink embeds (`![[image.png]]`) only work inside Obsidian and
 * are stripped from merged output with a warning.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Regex Patterns ─────────────────────────────────────────────────────────

/** `![alt](target)` with optional "title" — target must not contain spaces or `)`. */
const IMAGE_LINK_RE = /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g;

/** Obsidian embed: `![[target]]` (images, notes, any vault attachment). */
const WIKILINK_EMBED_RE = /!\[\[[^\]]*\]\]/g;

/** URL scheme (http:, https:, data:, …) — at least 2 chars so `C:` drive letters do not match. */
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;

const FENCE_RE = /^\s*(```|~~~)/;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ImageRewriteResult {
    content: string;
    /** Human-readable problems found (missing files, stripped wikilinks). */
    warnings: string[];
    /** Absolute paths (forward-slash) of all image files referenced after rewriting. */
    imagePaths: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toForwardSlashes(p: string): string {
    return p.replaceAll('\\', '/');
}

function isExternalTarget(target: string): boolean {
    return URL_SCHEME_RE.test(target);
}

/**
 * Split text into segments, applying `transform` only to lines outside
 * fenced code blocks. Preserves original line breaks.
 */
function mapOutsideFences(text: string, transform: (line: string) => string): string {
    const parts = text.split(/(\r?\n)/);
    const out: string[] = [];
    let inFence = false;

    for (let i = 0; i < parts.length; i += 2) {
        const line = parts[i] ?? '';
        const lineBreak = parts[i + 1] ?? '';

        if (FENCE_RE.test(line)) {
            inFence = !inFence;
            out.push(line + lineBreak);
            continue;
        }

        out.push((inFence ? line : transform(line)) + lineBreak);
    }

    return out.join('');
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve relative markdown image links against the source file's directory
 * and strip Obsidian wikilink embeds.
 *
 * - External targets (`http:`, `https:`, `data:`, …) are left untouched.
 * - Absolute paths are normalized to forward slashes but not relocated.
 * - Relative paths are resolved against `sourceDir` (matching how VS Code
 *   and Obsidian previews resolve them).
 * - Resolved local paths that do not exist produce a warning; the link is
 *   kept so the author can see the broken reference in the output.
 * - `![[embed]]` wikilinks are removed with a warning (Obsidian-only syntax).
 *
 * `sourceLabel` is used to prefix warnings (e.g. the file's name).
 */
export function rewriteImageLinks(
    content: string,
    sourceDir: string,
    sourceLabel: string
): ImageRewriteResult {
    const warnings: string[] = [];
    const imagePaths: string[] = [];

    const result = mapOutsideFences(content, (line) => {
        let processed = line.replaceAll(WIKILINK_EMBED_RE, (match) => {
            warnings.push(
                `${sourceLabel}: removed Obsidian embed ${match} — it only renders inside Obsidian. ` +
                'Use markdown image syntax instead: ![](path/to/image.png)'
            );
            return '';
        });

        processed = processed.replaceAll(IMAGE_LINK_RE, (match, alt: string, target: string, title: string | undefined) => {
            if (isExternalTarget(target)) {
                return match;
            }

            const resolved = path.isAbsolute(target)
                ? path.normalize(target)
                : path.resolve(sourceDir, target);
            const forward = toForwardSlashes(resolved);

            if (!fs.existsSync(resolved)) {
                warnings.push(`${sourceLabel}: image not found: ${target} (resolved to ${forward})`);
            } else {
                imagePaths.push(forward);
            }

            return `![${alt}](${forward}${title ?? ''})`;
        });

        return processed;
    });

    return { content: result, warnings, imagePaths };
}

// ─── Portable Markdown Export ───────────────────────────────────────────────

export interface PortableCopyResult {
    content: string;
    /** Files copied, as absolute destination paths. */
    copied: string[];
    warnings: string[];
}

/**
 * Make merged markdown portable: copy every locally-resolved image into
 * `<outputDir>/Images/` and rewrite links to relative `Images/<name>` paths,
 * so `book.md` + `Images/` can be moved or shared as a unit.
 *
 * Name collisions (same basename, different source file) are resolved by
 * suffixing: `map.png`, `map-2.png`, …. The same source path always maps to
 * the same destination.
 */
export function makePortableMarkdown(
    content: string,
    outputDir: string,
    imagesFolderName = 'Images'
): PortableCopyResult {
    const warnings: string[] = [];
    const copied: string[] = [];
    const sourceToDest = new Map<string, string>();   // absolute source → dest basename
    const usedNames = new Map<string, string>();      // dest basename (lowercase) → source it belongs to

    function destNameFor(absSource: string): string {
        const existing = sourceToDest.get(absSource);
        if (existing) { return existing; }

        const ext = path.extname(absSource);
        const stem = path.basename(absSource, ext);
        let candidate = `${stem}${ext}`;
        let counter = 2;
        while (usedNames.has(candidate.toLowerCase()) && usedNames.get(candidate.toLowerCase()) !== absSource) {
            candidate = `${stem}-${counter}${ext}`;
            counter++;
        }

        usedNames.set(candidate.toLowerCase(), absSource);
        sourceToDest.set(absSource, candidate);
        return candidate;
    }

    const imagesDir = path.join(outputDir, imagesFolderName);
    let imagesDirCreated = fs.existsSync(imagesDir);

    const result = mapOutsideFences(content, (line) =>
        line.replaceAll(IMAGE_LINK_RE, (match, alt: string, target: string, title: string | undefined) => {
            if (isExternalTarget(target) || !path.isAbsolute(target)) {
                return match;
            }

            const absSource = path.normalize(target);
            if (!fs.existsSync(absSource)) {
                // Missing images were already reported during rewriting; leave the link as-is.
                return match;
            }

            const destName = destNameFor(absSource);
            const destPath = path.join(imagesDir, destName);

            if (!copied.includes(destPath)) {
                try {
                    if (!imagesDirCreated) {
                        fs.mkdirSync(imagesDir, { recursive: true });
                        imagesDirCreated = true;
                    }
                    fs.copyFileSync(absSource, destPath);
                    copied.push(destPath);
                } catch (err: unknown) {
                    warnings.push(
                        `Failed to copy image ${toForwardSlashes(absSource)} to ${toForwardSlashes(destPath)}: ` +
                        (err instanceof Error ? err.message : String(err))
                    );
                    return match;
                }
            }

            return `![${alt}](${imagesFolderName}/${destName}${title ?? ''})`;
        })
    );

    return { content: result, copied, warnings };
}

// ─── Legacy chapterN images ─────────────────────────────────────────────────

/** Legacy implicit image name for a merge file kind, or undefined if none applies. */
export function legacyImageName(kind: 'prologue' | 'epilogue' | 'chapter', chapterNum?: number): string {
    switch (kind) {
        case 'prologue': return 'prologue.jpg';
        case 'epilogue': return 'epilogue.jpg';
        case 'chapter': return `chapter${chapterNum}.jpg`;
    }
}

/** True if the content already references any markdown image link. */
export function hasImageLink(content: string): boolean {
    IMAGE_LINK_RE.lastIndex = 0;
    return IMAGE_LINK_RE.test(content);
}
