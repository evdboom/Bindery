import type { TemplateContext, TemplateMeta } from '../context';

export const meta: TemplateMeta = {
    file:    '.claude/skills/review/SKILL.md',
    version: 13,
    label:   'review skill',
    zip:     '.claude/skills/review.zip',
};

export function render(_ctx: TemplateContext): string {
    return `---
name: review
description: Bindery workspace - Review a chapter for language, arc consistency, and age-appropriateness. Use for /review, "review chapter X", "quick review", or "review my changes".
---
# Skill: /review

Review a chapter and give structured feedback.

## Prerequisites
This skill requires a Bindery workspace. If unsure, call \`identify_book\` to check.

## Trigger
User says \`/review\`, "review chapter X", "quick review", or "review my changes".

## Clarify first
- Changes, chapter, translation, or overall feedback?
- Type: **Full** (language + arc + age-appropriateness) or **Quick** (language and typos only)?

## Tools
Use these Bindery MCP tools to gather context:
- \`get_review_text(autoStage: true, contextLines: 3)\` — returns the git diff of uncommitted changes **plus** any regions wrapped in \`<!-- Bindery: Review start -->\` / \`<!-- Bindery: Review stop -->\` markers (works even on committed work). \`autoStage: true\` stages reviewed files **and** removes the marker lines from disk so the next call only shows new changes. Pass more contextLines when join points to existing prose need checking
- \`get_chapter(chapterNumber, language)\` — read the full chapter text
- \`get_notes(category, name)\` — look up character profiles (\`category: "Characters"\`) or world rules
- \`search(query, language)\` — find related passages across the book
- \`git_snapshot(message)\` — after a successful review, suggest saving a snapshot

## Steps

### 1. Load settings and context
Start by reading ".bindery/settings.json" with \
\`get_text(".bindery/settings.json")\` to pick up the current book's target audience, genre, and story structure.

Load the right context, pick any or all as needed:
- Read \`.bindery/memories/global.md\`
- Read \`.bindery/memories/chXX.md\` if it exists for chapter-specific context
- Use \`get_chapter\` to load the chapter
- For a Full review, read the relevant arc file from \`Arc/\`.
- For "review my changes", use \`get_review_text\` to get the diff
- If the diff includes translated chapter files, flag that and offer \`/translation-review\` for source-vs-translation feedback

### 2. Perform the review

**Quick** — language and typos only.

**Full** — adds:
- Arc consistency with the arc file
- Age-appropriateness for the book's configured target audience
- Character consistency (use \`get_notes(category: "Characters")\`)

### 3. Output format

| Location | Before | Suggested | Reason |
|---|---|---|---|
| Line X | ...original... | ...suggestion... | reason |

- Bold changed words
- Group by category for Full reviews
- End with a 2-3 sentence overall impression

### 4. After review
If the review looks good, suggest: "Want me to save a snapshot?" (calls \`git_snapshot\`).

## Rules
- Do not rewrite unless asked — suggest only
`;
}
