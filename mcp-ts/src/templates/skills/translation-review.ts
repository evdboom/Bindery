import type { TemplateContext, TemplateMeta } from '../context';

export const meta: TemplateMeta = {
    file:    '.claude/skills/translation-review/SKILL.md',
    version: 2,
    label:   'translation-review skill',
    zip:     '.claude/skills/translation-review.zip',
};

export function render(_ctx: TemplateContext): string {
    return `---
name: translation-review
description: Bindery workspace - Review a hand-crafted translation against the source language for fidelity, naturalness, and glossary consistency. Use for /translation-review, "review my translation", or "what do you think" when translation is the current focus.
---
# Skill: /translation-review

Review a hand-crafted translation against the source.

Use this when the user has written or updated the target-language text and wants structured feedback.

## Prerequisites
This skill requires a Bindery workspace. If unsure, call \`identify_book\` to check.

## Trigger
User says \`/translation-review\`, "review my translation", or "what do you think" when translation is the active focus.

## Not this skill
- Generating translation text from scratch -> use \`/translate\`
- Reviewing source-language writing quality -> use \`/review\`

## Tools
Use these Bindery MCP tools:
- \`get_review_text(autoStage: true, contextLines: 3)\` — git diff of uncommitted changes **plus** any regions wrapped in \`<!-- Bindery: Review start -->\` / \`<!-- Bindery: Review stop -->\` markers. Marker regions surface even after the author committed and continued elsewhere. \`autoStage: true\` stages files **and** consumes (removes) the marker lines so the next pass starts clean.
- \`get_text(identifier, startLine?, endLine?)\` — fetch matching source lines or focused ranges
- \`get_translation(targetLanguage)\` — load glossary terms for the target language before reviewing
- \`get_chapter(chapterNumber, language)\` — full chapter source/target pair for full spot-check mode
- \`search(query, targetLanguage)\` — verify how a term was used in previously translated chapters before flagging it
- \`add_translation(targetLanguage, from, to)\` — persist a confirmed glossary correction

## Mode 1 - Scoped diff review (primary)

### Steps

1. Call \`get_review_text\`. The response has two sections: a \`# Git diff\` block and a \`# Review markers\` block (one or both may be empty).
2. If both sections are empty, report that nothing new has been translated yet.
3. Identify changed files and determine source/target language from available context: session file (for example COWORK.md), recent conversation, or ask the user if ambiguous.
4. If the target-language file changed (or has marker regions), capture the changed/marked target line range.
5. **Line parity matching** — attempt to fetch the corresponding source lines:
   - First, assume line parity: call \`get_text(sourceFile, startLine, endLine)\` for the same range as the target.
   - **If the content is a complete mismatch** (opening words differ significantly), the translation work may have added or removed lines. Search a window: fetch \`get_text(sourceFile, startLine - 5, endLine + 5)\` and scan for the target text within that range.
   - **If still not found**, ask the user: "I couldn't locate these source lines. Can you point me to the starting line number in the source file for this translation?"
6. Load glossary entries via \`get_translation(targetLanguage)\`.
7. Use \`search(query, targetLanguage)\` when a term may have an established translation elsewhere in the book.
8. Compare source vs target and produce feedback using the table below.
9. If source-language lines also changed, flag that and suggest \`/review\` for source-quality feedback.

## Mode 2 - Full chapter spot-check

Use this when the user asks for a full chapter comparison.

1. Determine source language, target language, and chapter number.
2. Load glossary with \`get_translation(targetLanguage)\`.
3. Use \`search(query, targetLanguage)\` as needed to verify recurring terminology in earlier translated chapters.
4. Load chapters with \`get_chapter(chapterNumber, sourceLanguage)\` and \`get_chapter(chapterNumber, targetLanguage)\`.
5. Compare paragraph by paragraph and report findings with the same table.

## Output format

| Before (target) | After (target) | Reason |
|---|---|---|
| Keep context short; bold only the changed words | Suggested wording | Fidelity, naturalness, glossary, or terminology consistency |

Also list glossary mismatches and untranslated world-specific terms explicitly.

## Cross-skill handoff
- If changed lines are only source-language files, suggest switching to \`/review\`.
- If both source and target changed, run translation-review findings first, then prompt whether to run \`/review\` for source edits too.

## Rules
- Load glossary before reviewing and flag mismatches explicitly
- Suggest edits only; do not rewrite entire passages unless asked
- Bold only changed words in Before/After rows
- Mark uncertain calls as questions for user confirmation
- When the user confirms a corrected term, call \`add_translation\` before moving on
- Respond in the session language (usually source language)
`;
}
