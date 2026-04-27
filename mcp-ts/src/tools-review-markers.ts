/**
 * Review-marker support for tool_get_review_text.
 *
 * Bindery review markers let an author tag arbitrary regions of a chapter
 * (or any markdown file) for inclusion in the next /review or
 * /translation-review pass — even after those changes have been committed.
 *
 *   <!-- Bindery: Review start -->
 *   ...content the author wants reviewed...
 *   <!-- Bindery: Review stop -->
 *
 * Rules:
 * - Stop marker is optional; an unclosed start runs to end of file.
 * - Multiple start/stop pairs in one file are supported.
 * - A stop with no preceding start is reported as a warning and ignored.
 * - A start nested inside an open region is reported as a warning; the
 *   inner start is treated as a no-op (the outer region keeps going).
 *
 * Pure helpers — no filesystem access. The caller (tools.ts) supplies the
 * file content and is responsible for IO and language filtering.
 */

export const REVIEW_START_MARKER = '<!-- Bindery: Review start -->';
export const REVIEW_STOP_MARKER  = '<!-- Bindery: Review stop -->';

export interface ReviewMarkerRegion {
    /** 1-based line number of the start marker (or 1 for an open-ended file). */
    startLine: number;
    /** 1-based line number of the stop marker, or undefined if unclosed. */
    stopLine?: number;
    /** Inner content lines (excluding marker lines themselves). */
    lines: string[];
    /** True when no stop marker was found and the region runs to EOF. */
    openEnded: boolean;
}

export interface ReviewMarkerScan {
    regions: ReviewMarkerRegion[];
    warnings: string[];
}

/** Match either marker, allowing leading whitespace. */
const START_RE = /^\s*<!--\s*Bindery:\s*Review\s+start\s*-->\s*$/i;
const STOP_RE  = /^\s*<!--\s*Bindery:\s*Review\s+stop\s*-->\s*$/i;

/** Scan one file's content and extract every Bindery review-marker region. */
export function scanReviewMarkers(content: string): ReviewMarkerScan {
    const lines    = content.split('\n');
    const regions: ReviewMarkerRegion[] = [];
    const warnings: string[] = [];

    let openStart: number | null   = null;
    let openLines: string[] | null = null;

    for (let i = 0; i < lines.length; i++) {
        const lineNo = i + 1;
        const text   = lines[i];

        if (START_RE.test(text)) {
            if (openStart !== null) {
                warnings.push(`line ${lineNo}: nested review-start marker ignored (region opened on line ${openStart}).`);
                continue;
            }
            openStart = lineNo;
            openLines = [];
            continue;
        }

        if (STOP_RE.test(text)) {
            if (openStart === null) {
                warnings.push(`line ${lineNo}: review-stop marker without a preceding start — ignored.`);
                continue;
            }
            regions.push({
                startLine: openStart,
                stopLine:  lineNo,
                lines:     openLines ?? [],
                openEnded: false,
            });
            openStart = null;
            openLines = null;
            continue;
        }

        if (openStart !== null && openLines !== null) {
            openLines.push(text);
        }
    }

    if (openStart !== null && openLines !== null) {
        warnings.push(`unclosed review-start on line ${openStart}: region runs to end of file.`);
        regions.push({
            startLine: openStart,
            stopLine:  undefined,
            lines:     openLines,
            openEnded: true,
        });
    }

    return { regions, warnings };
}

/**
 * Remove every review-marker line from `content`. Inner content stays.
 * Returns the new text and a count of removed marker lines.
 */
export function stripReviewMarkers(content: string): { text: string; removed: number } {
    const lines = content.split('\n');
    const out: string[] = [];
    let removed = 0;
    for (const line of lines) {
        if (START_RE.test(line) || STOP_RE.test(line)) {
            removed++;
            continue;
        }
        out.push(line);
    }
    return { text: out.join('\n'), removed };
}

export interface FormattedMarkerFile {
    file: string;
    regions: ReviewMarkerRegion[];
    warnings: string[];
}

/** Render the review-marker section of a get_review_text response. */
export function formatReviewMarkerFiles(files: FormattedMarkerFile[]): string {
    const parts: string[] = [];
    for (const f of files) {
        const lines: string[] = [`## ${f.file} — review markers`];
        for (const w of f.warnings) {
            lines.push(`> warning: ${w}`);
        }
        for (const r of f.regions) {
            const range = r.stopLine !== undefined
                ? `lines ${r.startLine + 1}-${r.stopLine - 1}`
                : `lines ${r.startLine + 1}-EOF`;
            const head = r.openEnded
                ? `@@ ${range} @@ (open-ended — no stop marker)`
                : `@@ ${range} @@`;
            lines.push('', head, ...r.lines);
        }
        parts.push(lines.join('\n'));
    }
    return parts.join('\n\n---\n\n');
}
