import { audienceNote, languageSection, type TemplateContext, type TemplateMeta } from './context';

export const meta: TemplateMeta = {
    file:    '.github/copilot-instructions.md',
    version: 11,
    label:   'copilot instructions',
    zip:     null,
};

export function render(ctx: TemplateContext): string {
    const { title, author, description, genre, storyFolder, notesFolder, arcFolder, charactersFolder, sessionFile, preferencesFile, arcGranularity } = ctx;
    const lines: string[] = [`# GitHub Copilot — ${title}`, ''];
    if (genre || description || ctx.audience) {
        lines.push('## Project');
        if (genre)       { lines.push(`${genre} novel.`); }
        if (description) { lines.push(description); }
        if (ctx.audience){ lines.push(audienceNote(ctx)); }
        if (author)      { lines.push(`Author: ${author}.`); }
        lines.push(languageSection(ctx), '');
    }
    lines.push(
        '## Repo layout',
        '```',
        `${arcFolder}/  ← story architecture (${arcGranularity}-level arc planning by default)`,
        `  index.md / Overall.md / Acts/`,
        `${notesFolder}/  ← story notes`,
        `${charactersFolder}/  ← character index and one profile per character`,
        `${sessionFile}  ← ephemeral working state (current focus / handoff) via session_focus_*`,
        `${preferencesFile}  ← durable working preferences; user-owned, never tool-written`,
        `${storyFolder}/`,
        ...ctx.languages.map(l => `  ${l.folderName}/  ← ${l.code} chapters`),
        '```',
        '',
        '## Shared skill workflows',
        '- Workspace skill files live in `.claude/skills/` and may also be picked up by agents beyond Claude.',
        '- Prefer those shared slash workflows when available: `/read-in`, `/review`, `/translation-review`, `/translate`, `/memory`, `/continuity`, `/status`, `/read-aloud`, `/proof-read`, `/plan-beats`, `/character-setup`.',
        '- Treat arc files as story architecture, not generic notes. Use `arc_*` tools for structure, `character_*` tools for durable cast facts, `note_*` tools for story notes, `memory_*` tools for cross-session decisions, and `session_focus_*` tools for current working state. Durable preferences are user-owned in PREFERENCES.md — propose changes rather than writing it.',
        '- Send rough, unsorted, or pasted material to `Notes/Inbox.md`, then triage it with `inbox_process` (propose destinations) and `inbox_resolve` (clear routed items) — do not dump it into memory.',
        '',
        '## Writing guidelines',
        '- HTML comments `<!-- -->` in chapter files are writer notes — treat as context only.',
        '- Quotation marks and dashes are managed by the Bindery VS Code extension. Do not normalize them.',
    );
    if (ctx.audience) {
        lines.push(`- Content targets ${ctx.audience}. Keep vocabulary accessible and themes appropriate.`);
    }
    return lines.join('\n') + '\n';
}
