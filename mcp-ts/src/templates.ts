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
 * SINGLE SOURCE OF TRUTH — do not edit the copy in vscode-ext/src/.
 */

import * as claude          from './templates/claude';
import * as copilot         from './templates/copilot';
import * as cursor          from './templates/cursor';
import * as agents          from './templates/agents';
import * as binderyReadme   from './templates/bindery-readme';
import * as review          from './templates/skills/review';
import * as brainstorm      from './templates/skills/brainstorm';
import * as memory          from './templates/skills/memory';
import * as translate       from './templates/skills/translate';
import * as translationReview from './templates/skills/translation-review';
import * as status          from './templates/skills/status';
import * as continuity      from './templates/skills/continuity';
import * as readAloud       from './templates/skills/read-aloud';
import * as readIn          from './templates/skills/read-in';
import * as proofRead       from './templates/skills/proof-read';

import type { TemplateContext, TemplateMeta } from './templates/context';

export type { TemplateContext } from './templates/context';

interface TemplateModule {
    meta:   TemplateMeta;
    render: (ctx: TemplateContext) => string;
}

const TEMPLATES: Record<string, TemplateModule> = {
    'claude':              claude,
    'copilot':             copilot,
    'cursor':              cursor,
    'agents':              agents,
    'bindery-readme':      binderyReadme,
    'review':              review,
    'brainstorm':          brainstorm,
    'memory':              memory,
    'translate':           translate,
    'translation-review':  translationReview,
    'status':              status,
    'continuity':          continuity,
    'read-aloud':          readAloud,
    'read-in':             readIn,
    'proof-read':          proofRead,
};

// ─── File version metadata ────────────────────────────────────────────────────
// Bump per-file version inside the matching module's `meta` when content
// changes significantly so users with outdated content are prompted.

export const FILE_VERSION_INFO: Record<string, { version: number; label: string; zip: string | null }> =
    Object.fromEntries(
        Object.values(TEMPLATES).map(t => [
            t.meta.file,
            { version: t.meta.version, label: t.meta.label, zip: t.meta.zip },
        ]),
    );

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Render a named template with the given context.
 *
 * Top-level file templates: 'claude', 'copilot', 'cursor', 'agents', 'bindery-readme'
 * Skill templates: 'review', 'brainstorm', 'memory', 'translate',
 *                  'translation-review', 'status', 'continuity', 'read-aloud',
 *                  'read-in', 'proof-read'
 */
export function renderTemplate(name: string, ctx: TemplateContext): string {
    const t = TEMPLATES[name];
    if (!t) { return `Unknown template: ${name}`; }
    return t.render(ctx);
}
