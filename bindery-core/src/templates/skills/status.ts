import type { TemplateContext, TemplateMeta } from '../context';

export const meta: TemplateMeta = {
    file:    '.claude/skills/status/SKILL.md',
    version: 10,
    label:   'status skill',
    zip:     '.claude/skills/status.zip',
};

export function render(_ctx: TemplateContext): string {
    return `---
name: status
description: Bindery workspace - Give a book progress snapshot — chapters done, in progress, and coming up. Use for /status, "what's the book status", or "where are we".
---
# Skill: /status

Snapshot of the book's progress: what's done, in progress, and coming up.

## Prerequisites
This skill requires a Bindery workspace. If unsure, call \`identify_book\` to check.

## Trigger
User says \`/status\`, "what's the book status", or "where are we".

## Tools
Use these Bindery MCP tools:
- \`chapter_status_get(book)\` — read the structured progress tracker from \`.bindery/chapter-status.json\`
- \`chapter_status_update(book, chapters)\` — upsert chapter progress entries (send only changed chapters)
- \`get_overview(language)\` — list all acts and chapters with titles
- \`get_text(identifier)\` — read COWORK.md, settings.json, and memory files
- \`memory_list\` — discover which chapter memory files exist (\`chXX.md\`)

## Steps

1. Use \`get_text(".bindery/settings.json")\` to pick up the current book's structure and conventions.
2. Use \`chapter_status_get\` to read the current tracker. Use \`memory_list\` to check available memory files.
3. Use \`get_text\` to read COWORK.md (current focus), \`.bindery/memories/global.md\`, and for in-progress chapters \`.bindery/memories/chXX.md\`.
4. Use \`get_overview\` for the full chapter listing if the tracker is empty or incomplete.
5. Check \`Arc/\` for what's planned vs written (Overall.md + the relevant act file).
6. Output: overall count / done / in-progress / coming up (next 2-3 chapters) / open questions.
7. If the tracker is out of date or missing entries, update it with \`chapter_status_update\` (upsert only the changed chapters).

## Output
Keep it scannable — bold headers, short lines. This is a working tool, not a narrative summary.
`;
}
