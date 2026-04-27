import type { TemplateContext, TemplateMeta } from '../context';

export const meta: TemplateMeta = {
    file:    '.claude/skills/continuity/SKILL.md',
    version: 12,
    label:   'continuity skill',
    zip:     '.claude/skills/continuity.zip',
};

export function render(_ctx: TemplateContext): string {
    return `---
name: continuity
description: Bindery workspace - Cross-check a chapter for consistency errors in characters, world rules, or timeline. Use for /continuity, "check continuity", or "check chapter X for errors".
---
# Skill: /continuity

Cross-check a chapter for consistency errors.

## Prerequisites
This skill requires a Bindery workspace. If unsure, call \`identify_book\` to check.

## Trigger
User says \`/continuity\`, "check continuity", or "check chapter X for errors".

## Clarify first
- Chapter: number
- Focus: all | characters | world rules | timeline

## Tools
Use these Bindery MCP tools:
- \`get_chapter(chapterNumber, language)\` — read a specific chapter
- \`get_book_until(chapterNumber, language, startChapter?)\` — load prior chapters in one call for timeline/continuity context
- \`get_notes(category, name)\` — look up character profiles or world rules
- \`search(query, language)\` — find earlier mentions of a character detail or event
- \`memory_list\` — check whether a chapter-specific memory file exists (\`chXX.md\`)

## Steps

1. Use \`get_text(".bindery/settings.json")\` to pick up the current book's structure and conventions.
2. Use \`get_chapter\` to read the chapter.
3. Use \`get_text\` to read \`.bindery/memories/global.md\`. Use \`memory_list\` to check if a chapter-specific memory file (\`chXX.md\`) exists; if so, read it with \`get_text\` too. Use \`get_notes(category: "Characters")\` for character profiles.
4. For world rules: use \`get_notes(category: "World")\`.
5. For timeline and continuity drift checks: use \`get_book_until\` up to the focus chapter. If unavailable, fall back to \`get_chapter\` for nearby prior chapters.
6. Use \`search\` to verify specific details against earlier chapters.

## Output format

| Type | Location | Issue | Reference |
|---|---|---|---|
| Character | Line X | Description contradicts... | global.md |

End with a one-line overall assessment. If no issues found, say so clearly.

## Rules
- Flag issues only — do not suggest rewrites
- Phrase uncertain items as questions, not errors
`;
}
