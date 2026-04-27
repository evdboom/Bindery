"use strict";
/**
 * Typography formatting for markdown files.
 *
 * Converts straight quotes to curly quotes, `...` to ellipsis,
 * and `--` to em-dash while preserving content inside HTML comments.
 *
 * Shared across vscode-ext, obsidian-plugin, and mcp-ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyTypography = void 0;
exports.updateTypography = updateTypography;
// ─── Typographic Characters ─────────────────────────────────────────────────
const OPEN_DOUBLE = '\u{201C}'; // "
const CLOSE_DOUBLE = '\u{201D}'; // "
const OPEN_SINGLE = '\u{2018}'; // '
const CLOSE_SINGLE = '\u{2019}'; // ' (also used for apostrophes)
const ELLIPSIS = '\u{2026}'; // …
const EM_DASH = '\u{2014}'; // —
// ─── Cached Regex Patterns ──────────────────────────────────────────────────
/** Matches HTML comments: <!-- ... --> */
const COMMENT_RE = /<!--[\s\S]*?-->/g;
/** Matches opening double quote context: after whitespace, line start, or brackets */
const OPEN_DOUBLE_RE = /(^|[\s([{—–-])"/gm;
/** Matches opening single quote context: after whitespace, line start, or brackets */
const OPEN_SINGLE_RE = /(^|[\s([{—–-])'/gm;
/** Matches a closing double quote after an em-dash at end-of-word or line */
const CLOSE_DOUBLE_AFTER_EM_DASH_RE = /—"([\s)\].,;:!?]|$)/gm;
// ─── Public API ─────────────────────────────────────────────────────────────
/**
 * Apply typographic formatting to text.
 *
 * - `...` → `…` (ellipsis)
 * - `--` → `—` (em-dash, but not `---` which is markdown HR)
 * - `"text"` → `\u201Ctext\u201D` (curly double quotes)
 * - `'text'` → `\u2018text\u2019` (curly single quotes / apostrophes)
 */
function updateTypography(text) {
    let result = text;
    // Step 1: Convert ... to ellipsis (must happen before quote processing)
    result = result.replaceAll(/\.\.\./g, ELLIPSIS);
    // Step 2: Protect HTML comments from em-dash conversion
    const protectedComments = [];
    result = result.replaceAll(COMMENT_RE, (match) => {
        const placeholder = `\x00COMMENT${protectedComments.length}\x00`;
        protectedComments.push(match);
        return placeholder;
    });
    // Step 3: Convert -- to em-dash (but preserve --- for markdown HR)
    const protectedTriple = '\x00TRIPLE\x00';
    result = result.replaceAll(/---/g, protectedTriple);
    result = result.replaceAll(/--/g, EM_DASH);
    result = result.replaceAll(new RegExp(escapeRegex(protectedTriple), 'g'), '---');
    // Step 4: Restore HTML comments
    for (let i = 0; i < protectedComments.length; i++) {
        result = result.replaceAll(`\x00COMMENT${i}\x00`, protectedComments[i]);
    }
    // Step 4b: Fix closing quotes after em-dash introduced from --
    result = result.replaceAll(CLOSE_DOUBLE_AFTER_EM_DASH_RE, (_match, after) => {
        return `${EM_DASH}${CLOSE_DOUBLE}${after}`;
    });
    // Step 5: Convert double quotes
    // Opening: after whitespace, start of line, or opening brackets
    result = result.replaceAll(OPEN_DOUBLE_RE, (_match, before) => {
        return `${before}${OPEN_DOUBLE}`;
    });
    // Closing: all remaining straight double quotes
    result = result.replaceAll(/"/g, CLOSE_DOUBLE);
    // Step 6: Convert single quotes
    // Opening: after whitespace, start of line, or opening brackets
    result = result.replaceAll(OPEN_SINGLE_RE, (_match, before) => {
        return `${before}${OPEN_SINGLE}`;
    });
    // Closing/apostrophe: all remaining straight single quotes
    result = result.replaceAll(/'/g, CLOSE_SINGLE);
    return result;
}
/** Alias for `updateTypography` — used by obsidian-plugin and other consumers. */
exports.applyTypography = updateTypography;
function escapeRegex(str) {
    return str.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=formatting.js.map