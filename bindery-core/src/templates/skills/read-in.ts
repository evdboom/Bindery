import type { TemplateContext, TemplateMeta } from '../context';

export const meta: TemplateMeta = {
    file:    '.claude/skills/read-in/SKILL.md',
    version: 12,
    label:   'read-in skill',
    zip:     '.claude/skills/read-in.zip',
};

export function render(_ctx: TemplateContext): string {
    return `---
name: read-in
description: Bindery workspace - Load project context at the start of a session — memory, progress tracker, and chapter notes. Use for /read-in, "get your bearings", "what were we doing", or at the start of any working session.
---
# Skill: /read-in

Load context and get your bearings before starting work.

## Prerequisites
This skill requires a Bindery workspace. If unsure, call \`identify_book\` to check.

## Trigger
User says \`/read-in\`, "get your bearings", "what were we working on", or at the start of a session.

## Tools
Use these Bindery MCP tools:
- \`update_workspace\` — fetch and pull the workspace before loading context; also reports current branch versus the remote default branch
- \`memory_list\` — discover which memory files exist (\`global.md\`, \`chXX.md\` files)
- \`get_text(identifier)\` — read COWORK.md and memory files
- \`chapter_status_get(book)\` — read the structured progress tracker
- \`get_overview(language)\` — list all acts and chapters (only if tracker is empty or sparse)
- \`get_notes(category, name)\` — look up key character or world notes if relevant to current focus
- \`search(query, language)\` — find relevant passages across the book based on current focus or open questions
- \`get_chapter(chapterNumber, language)\` — read a chapter if that's the current focus

## Steps

### 0. Sync repository
Call \`update_workspace\` before loading any context.
- If the update fails (for example: no remote, merge issue, or upstream problem), flag it to the user and stop — do not proceed with stale context.
- If the tool reports that the current branch differs from the remote default branch, mention that briefly so the user can decide whether to switch.
- If the tool reports that the workspace is already up to date, say nothing unless the branch status matters.

### 1. Check for current focus
Use \`get_text("COWORK.md")\` to read the current focus file (ignore if missing).

### 2. Load global memory
Use \`get_text(".bindery/settings.json")\` first to pick up the current book's structure and conventions.
Then use \`memory_list\` to discover available memory files, and \`get_text(".bindery/memories/global.md")\` to load cross-chapter decisions.

### 3. Read the progress tracker
Use \`chapter_status_get\` to read current chapter progress. If it is empty or has fewer than 3 entries, also call \`get_overview\` for the full chapter listing.

### 4. Determine working chapter
If COWORK.md names a chapter, use that.
Otherwise if the tracker has a single \`in-progress\` chapter, use that.
Otherwise — **ask the user**: "Which chapter do you want to work on?"

### 5. Load chapter memory
- Once the chapter is known (e.g. chapter 10), check \`memory_list\` output for a matching file (\`ch10.md\`). If it exists, read it with \`get_text(".bindery/memories/ch10.md")\`.
- Also read the full chapter text with \`get_chapter\` to have it fresh in context, and to check for any discrepancies with the memory file.

### 6. Story / Arc focus
Depending on the focus and open questions, use \`get_notes\` or \`search\` to load any additional relevant context.

### 7. Summarize
Output a short orientation (3-6 lines):
- Which chapter / scene we're in
- Status from the tracker (draft / in-progress / needs-review)
- Key open decisions from global memory relevant to this chapter
- Any chapter-specific notes from the chapter memory file
- End with a phrase like: "Ready — what would you like to work on?"

## Rules
- Do not load *all* chapter memories — only the one being worked on
- Keep the summary brief; this is orientation, not a full status report
- Do not suggest work or ask multiple questions — one question at most (which chapter?)
`;
}
