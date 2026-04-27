/**
 * Typography formatting for markdown files.
 *
 * Converts straight quotes to curly quotes, `...` to ellipsis,
 * and `--` to em-dash while preserving content inside HTML comments.
 *
 * Shared across vscode-ext, obsidian-plugin, and mcp-ts.
 */
/**
 * Apply typographic formatting to text.
 *
 * - `...` → `…` (ellipsis)
 * - `--` → `—` (em-dash, but not `---` which is markdown HR)
 * - `"text"` → `\u201Ctext\u201D` (curly double quotes)
 * - `'text'` → `\u2018text\u2019` (curly single quotes / apostrophes)
 */
export declare function updateTypography(text: string): string;
/** Alias for `updateTypography` — used by obsidian-plugin and other consumers. */
export declare const applyTypography: typeof updateTypography;
