import type { TemplateContext, TemplateMeta } from '../context';

export const meta: TemplateMeta = {
    file:    '.claude/skills/brainstorm/SKILL.md',
    version: 11,
    label:   'brainstorm skill',
    zip:     '.claude/skills/brainstorm.zip',
};

export function render(_ctx: TemplateContext): string {
    return `---
name: brainstorm
description: Bindery workspace - Brainstorm story ideas, plot beats, character moments, or scene concepts. Use for /brainstorm, "I'm stuck", "help me think of ideas", or "Am I stuck?".
---
# Skill: /brainstorm

Brainstorm story ideas, character moments, or plot solutions.

## Prerequisites
This skill requires a Bindery workspace. If unsure, call \`identify_book\` to check.

## Trigger
User says \`/brainstorm\`, "I'm stuck", "help me think of ideas", or "Am I stuck?".

## Clarify first
- Scope: plot beat | character moment | scene idea | chapter open/close
- Chapter/story point: specify one
- Constraints: list any

## Tools
Use these Bindery MCP tools to gather context:
- \`search(query, language)\` — find thematic parallels and related moments across the book
- \`get_notes(category, name)\` — look up character profiles, world rules, or equipment details
- \`get_chapter(chapterNumber, language)\` — read a specific chapter for reference

## Steps

1. Read ".bindery/settings.json" with \`get_text\` to pick up the current book's genre, target audience, and story structure.
2. Read \`.bindery/memories/global.md\` and the relevant arc file from \`Arc/\`.
3. If chapter specific, read \`.bindery/memories/chXX.md\` if it exists.
4. If character-focused, use \`get_notes(category: "Characters")\` for character profiles.
5. Use \`search\` to find related moments or themes already in the book.
6. Generate 3-5 concrete ideas that fit the arc and feel true to the characters.

## Output format

**Option A — [short title]**
[3-5 sentence description]

...

End with a brief note on which options feel most aligned with the arc.

## Rules
- Respect established world rules and character voices
- Keep ideas appropriate for the book's configured target audience
`;
}
