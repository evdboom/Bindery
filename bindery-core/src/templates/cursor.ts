import type { TemplateContext, TemplateMeta } from './context';

export const meta: TemplateMeta = {
    file:    '.cursor/rules',
    version: 8,
    label:   'cursor rules',
    zip:     null,
};

export function render(ctx: TemplateContext): string {
    const { title, storyFolder, notesFolder, arcFolder, memoriesFolder } = ctx;
    const lines: string[] = [
        `# Cursor rules — ${title}`,
        '',
        `Story folder: \`${storyFolder}/\``,
        `Notes folder: \`${notesFolder}/\``,
        `Arc folder: \`${arcFolder}/\` (Overall.md, Act_I_*.md, Act_II_*.md, Act_III_*.md)`,
        '',
        '## Context files to read',
        `- \`${memoriesFolder}/global.md\` — cross-chapter decisions (read at start of session)`,
        `- \`${arcFolder}/\` — story arc files for overall and per-act structure and beats`,
        `- \`${notesFolder}/\` — story notes, like character profiles and world rules`,
        '- Shared workflows live in `.claude/skills/`; if your runtime exposes them, prefer `/read-in`, `/review`, `/translation-review`, `/translate`, `/memory`, `/continuity`, `/status`, `/read-aloud`, and `/proof-read` for those tasks.',
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
