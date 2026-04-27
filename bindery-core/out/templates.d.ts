/**
 * Bindery AI instruction file templates — thin aggregator.
 *
 * Each template lives in its own file under `./templates/`. Each module
 * exports `{ meta, render }` so the version stays glued to the content.
 * This file just collects them and exposes the public API:
 *
 *   - `TemplateContext`   — re-exported from ./templates/context
 *   - `FILE_VERSION_INFO` — built from each module's `meta`
 *   - `renderTemplate(name, ctx)` — dispatches to the right module
 *
 * SINGLE SOURCE OF TRUTH — this is the canonical copy in bindery-core.
 * Do not hand-edit copies in mcp-ts/src/ or vscode-ext/src/.
 */
import type { TemplateContext } from './templates/context';
export type { TemplateContext } from './templates/context';
export declare const FILE_VERSION_INFO: Record<string, {
    version: number;
    label: string;
    zip: string | null;
}>;
/**
 * Render a named template with the given context.
 *
 * Top-level file templates: 'claude', 'copilot', 'cursor', 'agents', 'bindery-readme'
 * Skill templates: 'review', 'brainstorm', 'memory', 'translate',
 *                  'translation-review', 'status', 'continuity', 'read-aloud',
 *                  'read-in', 'proof-read'
 */
export declare function renderTemplate(name: string, ctx: TemplateContext): string;
