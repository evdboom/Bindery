import type { TemplateContext, TemplateMeta } from './context';

export const meta: TemplateMeta = {
    file:    '.cursor/rules',
    version: 10,
    label:   'cursor rules',
    zip:     null,
};

export function render(ctx: TemplateContext): string {
    const { title, storyFolder, notesFolder, arcFolder, charactersFolder, sessionFile, preferencesFile, arcGranularity, memoriesFolder } = ctx;
    const lines: string[] = [
        `# Cursor rules — ${title}`,
        '',
        `Story folder: \`${storyFolder}/\``,
        `Notes folder: \`${notesFolder}/\``,
        `Arc folder: \`${arcFolder}/\` (index.md, Overall.md, Acts/; default granularity: ${arcGranularity})`,
        `Characters folder: \`${charactersFolder}/\``,
        `Session file: \`${sessionFile}\` (ephemeral working state)`,
        `Preferences file: \`${preferencesFile}\` (durable, user-owned)`,
        '',
        '## Context files to read',
        `- \`${sessionFile}\` — ephemeral working state (current focus, next actions, open questions, handoff) via \`session_focus_*\``,
        `- \`${preferencesFile}\` — durable working preferences ("do it like this for me"); user-owned, never tool-written`,
        `- \`${memoriesFolder}/global.md\` — cross-chapter decisions (read at start of session)`,
        `- \`${arcFolder}/\` — story architecture, structure, pacing, and beats`,
        `- \`${charactersFolder}/\` — character index and one profile per character`,
        `- \`${notesFolder}/\` — story notes, like world rules, scene ideas, inbox, and research`,
        '- Shared workflows live in `.claude/skills/`; if your runtime exposes them, prefer `/read-in`, `/review`, `/translation-review`, `/translate`, `/memory`, `/continuity`, `/status`, `/read-aloud`, `/proof-read`, `/plan-beats`, and `/character-setup` for those tasks.',
        '- Use `arc_*` tools for story structure, `character_*` tools for cast profiles, `note_*` tools for story notes, `memory_*` tools for session decisions, `chapter_status_*` tools for progress, and `session_focus_*` tools for current working state.',
        '',
        '## Rules',
        '- HTML comments `<!-- -->` in chapter files are writer notes. Treat as context, not story content.',
        '- Do not normalize quotation marks or dashes — these are managed by the Bindery extension.',
        '- Do not rewrite prose unless explicitly asked. Suggest edits only.',
    ];
    if (ctx.audience) {
        lines.push(`- Target audience is ${ctx.audience}. Flag content that is too complex or inappropriate.`);
    }
    return lines.join('\n') + '\n';
}
