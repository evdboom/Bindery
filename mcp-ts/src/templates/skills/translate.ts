import type { TemplateContext, TemplateMeta } from '../context';

export const meta: TemplateMeta = {
    file:    '.claude/skills/translate/SKILL.md',
    version: 9,
    label:   'translate skill',
    zip:     '.claude/skills/translate.zip',
};

export function render(_ctx: TemplateContext): string {
    return `---
name: translate
description: Bindery workspace - Translate a chapter or spot-check an existing translation using the Bindery translation table. Use for /translate, "translate chapter X", or "help me with the translation".
---
# Skill: /translate

Translate a chapter or passage into the target language.

## Prerequisites
This skill requires a Bindery workspace. If unsure, call \`identify_book\` to check.

## Trigger
User says \`/translate\`, "translate chapter X", or "help me with the translation".

## Clarify first
- Which chapter number and target language?
- Full translation or spot-check an existing translation? Default to spot-check if a chapter file already exists for the target language.

## Tools
Use these Bindery MCP tools:
- \`get_chapter(chapterNumber, language)\` — read a chapter in any language (source or existing translation)
- \`get_translation(targetLanguage)\` — list glossary entries for a target language (e.g. \`"nl"\`)
- \`get_translation(targetLanguage, word)\` — look up a specific term; forgiving: case-insensitive, handles plurals and inflected forms
- \`search(query, targetLanguage)\` — verify how a term was rendered in other translated chapters
- \`add_translation(targetLanguage, from, to)\` — save a new glossary term pair when the user confirms a translation choice

## Steps

### 1. Load the translation table
Call \`get_translation(targetLanguage)\` to load all known glossary term mappings for the target language before translating anything.

### 2. Load the chapter
Use \`get_chapter(chapterNumber, sourceLanguage)\` to read the source chapter.
For spot-check mode, also call \`get_chapter(chapterNumber, targetLanguage)\` to read the existing translation.

### 3. Translate or review
**Full translation** — translate paragraph by paragraph, applying all terms from the glossary. Output the full result in a fenced \`\`\`markdown block for easy pasting.

**Spot-check** — compare source and translation side-by-side. Use a feedback table:

| Location | Source | Current translation | Suggestion | Reason |
|---|---|---|---|---|

### 4. Save confirmed terms
When the user confirms a new or corrected term translation, call \`add_translation\` to persist it as a glossary entry. For spelling variant rules (dialect substitutions applied at export), use \`add_dialect\` instead.

## Rules
- Always load the translation table first — never invent translations for world-specific terms
- Flag uncertain terms rather than guessing
`;
}
