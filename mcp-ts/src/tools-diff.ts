/**
 * Unified-diff parsing and formatting helpers used by tool_get_review_text.
 *
 * Extracted from tools.ts for readability. Pure functions — no filesystem access.
 */

export interface DiffFile {
    file: string;
    hunks: DiffHunk[];
}

export interface DiffHunk {
    beforeStart: number;
    beforeCount: number;
    afterStart:  number;
    afterCount:  number;
    lines: DiffLine[];
}

export interface DiffLine {
    type: 'context' | 'insert' | 'delete';
    text: string;
    oldLine?: number;
    newLine?: number;
}

function parseHunkLines(body: string, beforeStart: number, afterStart: number): DiffLine[] {
    const lines: DiffLine[] = [];
    let oldLine = beforeStart;
    let newLine = afterStart;
    for (const line of body.split('\n')) {
        if (line.startsWith('+')) {
            lines.push({ type: 'insert', text: line.slice(1), newLine: newLine++ });
        } else if (line.startsWith('-')) {
            lines.push({ type: 'delete', text: line.slice(1), oldLine: oldLine++ });
        } else if (line.startsWith(' ')) {
            lines.push({ type: 'context', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
        }
    }
    return lines;
}

export function parseUnifiedDiff(raw: string): DiffFile[] {
    const files: DiffFile[] = [];
    const fileChunks = raw.split(/^diff --git /m).filter(Boolean);

    for (const chunk of fileChunks) {
        const nameMatch = /^a\/(.+?)\s+b\/(.+)/m.exec(chunk);
        if (!nameMatch) { continue; }
        const fileName = nameMatch[2];

        const hunks: DiffHunk[] = [];
        for (const hunkPart of chunk.split(/^@@\s+/m).slice(1)) {
            const headerMatch = /^-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)/.exec(hunkPart);
            if (!headerMatch) { continue; }

            const beforeStart = Number.parseInt(headerMatch[1], 10);
            const beforeCount = headerMatch[2] === undefined ? 1 : Number.parseInt(headerMatch[2], 10);
            const afterStart  = Number.parseInt(headerMatch[3], 10);
            const afterCount  = headerMatch[4] === undefined ? 1 : Number.parseInt(headerMatch[4], 10);

            const body = headerMatch[5] + '\n' + hunkPart.slice(headerMatch[0].length);
            hunks.push({ beforeStart, beforeCount, afterStart, afterCount, lines: parseHunkLines(body, beforeStart, afterStart) });
        }

        files.push({ file: fileName, hunks });
    }

    return files;
}

export function formatReviewFiles(files: DiffFile[]): string {
    const parts: string[] = [];

    for (const file of files) {
        const lines: string[] = [`## ${file.file}`];

        for (const hunk of file.hunks) {
            lines.push(`\n@@ -${hunk.beforeStart},${hunk.beforeCount} +${hunk.afterStart},${hunk.afterCount} @@`);
            for (const l of hunk.lines) {
                const lineType = (() => {
                    switch (l.type) {
                        case 'delete': return '-';
                        case 'insert': return '+';
                        default: return ' ';
                    }
                })();
                lines.push(`${lineType} ${l.text}`);
            }
        }

        parts.push(lines.join('\n'));
    }

    return parts.join('\n\n---\n\n');
}
