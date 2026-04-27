import type { TemplateContext, TemplateMeta } from '../context';

export const meta: TemplateMeta = {
    file:    '.claude/skills/memory/SKILL.md',
    version: 11,
    label:   'memory skill',
    zip:     '.claude/skills/memory.zip',
};

export function render(_ctx: TemplateContext): string {
    return `---
name: memory
description: Bindery workspace - Save session decisions to persistent memory files using Bindery MCP tools. Use for /memory, "save this to memory", "update memories", or at end of session.
---
# Skill: /memory

Update project memory files with decisions from the current session.

## Prerequisites
This skill requires a Bindery workspace. If unsure, call \`identify_book\` to check.

## Trigger
User says \`/memory\`, "save this to memory", "update memories", at meaningful points, or at session end.

## Tools
Use these Bindery MCP tools:
- \`memory_list\` — discover which memory files exist and their line counts
- \`memory_append(file, title, content)\` — append a dated session entry; the tool stamps the date automatically
- \`memory_compact(file, compacted_content)\` — overwrite a file with a summary; backs up the original to \`archive/\` automatically
- \`git_snapshot(message)\` — after updating memories, offer to save a snapshot

## Steps

### 0. Cross-check assistant memory (if available)
If the runtime has local/session memory, review entries from this session.
Promote repo-worthy entries into Step 3 content.

Promote:
- Story/craft decisions
- Character or world rules
- Structural decisions needed in future sessions
- Anything that must survive across devices

Keep local only:
- Workflow/tool preferences
- Assistant behavior feedback
- Setup/environment notes
- Session-local context

If no local/session memory exists, skip this step.

### 1. Identify what to save
List the decisions, insights, or facts from the session worth preserving.

### 2. Check existing files
Use \`memory_list\` to see which memory files exist and how large they are.

### 3. Append the entry
Use \`memory_append\` to write to the right file:
- \`global.md\` — cross-chapter decisions (character names, world rules, style choices)
- \`chXX.md\` — chapter-specific decisions (e.g. \`ch10.md\`)

Arguments:
- \`file\`: just the filename, e.g. \`global.md\` or \`ch10.md\`
- \`title\`: short topic label, e.g. \`"Elder introduction — character decisions"\`
- \`content\`: the decisions to record, one per line

The tool stamps the current date. Do not add a date to the content.

### 4. Compact if needed
If \`memory_list\` shows a file exceeding ~150 lines, offer to compact it:
- Summarize the existing content into a concise replacement
- Call \`memory_compact(file, compacted_content)\` — original is backed up automatically

### 5. Snapshot
Offer to save a snapshot with \`git_snapshot\`.

## Rules
- Always use \`memory_append\` — never use the Edit tool to write to memory files
- Do not add dates to content — the tool stamps them automatically
- Compaction is always opt-in
`;
}
