import { audienceNote, languageSection, type TemplateContext, type TemplateMeta } from './context';

export const meta: TemplateMeta = {
    file:    'AGENTS.md',
    version: 10,
    label:   'agents instructions',
    zip:     null,
};

export function render(ctx: TemplateContext): string {
    const { title, author, description, genre, storyFolder, notesFolder, arcFolder, charactersFolder, sessionFile, preferencesFile, arcGranularity, memoriesFolder } = ctx;
    const lines: string[] = [`# Agent Instructions — ${title}`, ''];
    lines.push('## Project overview');
    if (genre)       { lines.push(`${genre} novel.`); }
    if (description) { lines.push(description); }
    if (ctx.audience){ lines.push(audienceNote(ctx)); }
    if (author)      { lines.push(`Author: ${author}.`); }
    lines.push(
        languageSection(ctx),
        '',
        '## Start of session',
        `1. Read \`${sessionFile}\` for current focus and handoff notes (via \`session_focus_get\`), and \`${preferencesFile}\` for the author's durable working preferences.`,
        `2. Read \`${memoriesFolder}/global.md\` for cross-chapter context.`,
        `3. If working on a specific chapter, read \`${memoriesFolder}/chXX.md\` if it exists.`,
        '4. Check `.claude/skills/` for shared slash workflows before improvising a bespoke process.',
        '',
        '## Story files',
        `- Chapter files are \`.md\` files in \`${storyFolder}/\`, organized in act subfolders.`,
        `- Arc files live in \`${arcFolder}/\`; default planning granularity is \`${arcGranularity}\`. Treat these as story architecture.`,
        `- Character profiles live in \`${charactersFolder}/\`; use one profile per character plus the index.`,
        '- HTML comments `<!-- -->` are writer notes — treat as context only, not prose.',
        '- Quotation marks and em-dashes are managed by the Bindery extension. Do not normalize them.',
        '',
        '## Shared skill workflows',
        '- Shared workflows live in `.claude/skills/` and can be used by agents beyond Claude when the runtime supports workspace skills.',
        '- Prefer `/read-in`, `/review`, `/translation-review`, `/translate`, `/memory`, `/continuity`, `/status`, `/read-aloud`, `/proof-read`, `/plan-beats`, and `/character-setup` when the user is asking for one of those structured tasks.',
        '- Use `arc_*` tools for story structure, `character_*` tools for cast profiles, `note_*` tools for story notes, `memory_*` tools for session decisions, `chapter_status_*` tools for progress, and `session_focus_*` tools for current working state. PREFERENCES.md is user-owned — propose changes rather than writing it.',
        '',
        '## Writing guidelines',
        '- Do not rewrite paragraphs unless explicitly asked. Suggest edits only.',
    );
    if (ctx.audience) {
        lines.push(`- Audience is ${ctx.audience}. Keep vocabulary clear and themes age-appropriate.`);
    }
    lines.push(
        '',
        '## Key reference files',
        '| File | Contains |',
        '|---|---|',
        `| \`${arcFolder}/\` | Story arc files for overall and per-act structure and beats |`,
        `| \`${charactersFolder}/\` | Character index and one profile per character |`,
        `| \`${notesFolder}/\` | Story notes, like world rules, scene ideas, inbox, and research |`,
        `| \`${sessionFile}\` | Ephemeral working state: current focus, next actions, open questions, handoff (via \`session_focus_*\`) |`,
        `| \`${preferencesFile}\` | Durable working preferences; user-owned, never tool-written |`,
        `| \`${memoriesFolder}/global.md\` | Cross-session decisions |`,
    );
    return lines.join('\n') + '\n';
}
