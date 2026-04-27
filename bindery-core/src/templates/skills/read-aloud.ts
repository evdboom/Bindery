import type { TemplateContext, TemplateMeta } from '../context';

export const meta: TemplateMeta = {
    file:    '.claude/skills/read-aloud/SKILL.md',
    version: 10,
    label:   'read-aloud skill',
    zip:     '.claude/skills/read-aloud.zip',
};

export function render(_ctx: TemplateContext): string {
    return `---
name: read-aloud
description: Bindery workspace - Test how a chapter or passage sounds when read aloud — flags long sentences, staccato rhythm, complex vocabulary, and said-bookisms. Use for /read-aloud, "reading test", or "how does this sound".
---
# Skill: /read-aloud

Test how a chapter sounds when read aloud.

## Prerequisites
This skill requires a Bindery workspace. If unsure, call \`identify_book\` to check.

## Trigger
User says \`/read-aloud\`, "reading test", or "how does this sound".

## Clarify first
- Whole chapter or specific passage?

## Runtime context
Before reviewing, read ".bindery/settings.json" with \`get_text\` to pick up the current book's target audience and genre.

## Tools
Use these Bindery MCP tools:
- \`get_chapter(chapterNumber, language)\` — read the full chapter
- \`get_text(identifier, startLine, endLine)\` — read a specific passage by line range

## What to check
- Sentences over ~30 words
- Sequences of 3+ short sentences (staccato)
- Vocabulary too complex for the book's configured target audience
- Said-bookisms in dialogue ("she exclaimed breathlessly" → prefer "said" or action beat)
- Paragraphs over 8 lines without a break
- Accidental word repetition within 2-3 sentences

## Output format

| Type | Location | Flagged text | Note |
|---|---|---|---|
| Long sentence | Para 3 | "..." (34 words) | Consider splitting |

Brief overall impression (2-3 sentences) after the table.

## Rules
- Focus on how it sounds when spoken — not a content review
- Suggestions are gentle ("consider", not "must change")
`;
}
