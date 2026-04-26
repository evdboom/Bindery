/**
 * Bindery AI instruction file templates.
 *
 * SINGLE SOURCE OF TRUTH — do not edit the copy in vscode-ext/src/.
 * The copy at vscode-ext/src/ai-setup-templates.ts is generated automatically:
 *   cp mcp-ts/src/templates.ts vscode-ext/src/ai-setup-templates.ts
 *
 * This file has zero imports. It exports TemplateContext, renderTemplate, and FILE_VERSION_INFO.
 */

// ─── Context ──────────────────────────────────────────────────────────────────

export interface TemplateContext {
    title:          string;
    author:         string;
    description:    string;
    genre:          string;
    audience:       string;
    storyFolder:    string;
    notesFolder:    string;
    arcFolder:      string;
    memoriesFolder: string;
    languages:      Array<{ code: string; folderName: string }>;
    langList:       string;
    hasMultiLang:   boolean;
}

// ─── File version metadata ────────────────────────────────────────────────────
// Bump per-file version when template content changes significantly.
// Bump FILE_VERSION_INFO[key].version so users with outdated content are prompted.

export const FILE_VERSION_INFO: Record<string, { version: number; label: string; zip: string | null }> = {
    'CLAUDE.md':                            { version: 10,  label: 'project instructions',    zip: null },
    '.github/copilot-instructions.md':      { version: 8,   label: 'copilot instructions',    zip: null },
    '.cursor/rules':                        { version: 8,   label: 'cursor rules',            zip: null },
    'AGENTS.md':                            { version: 8,   label: 'agents instructions',     zip: null },
    '.claude/skills/review/SKILL.md':       { version: 12,  label: 'review skill',            zip: '.claude/skills/review.zip' },
    '.claude/skills/brainstorm/SKILL.md':   { version: 11,  label: 'brainstorm skill',        zip: '.claude/skills/brainstorm.zip' },
    '.claude/skills/memory/SKILL.md':       { version: 11,  label: 'memory skill',            zip: '.claude/skills/memory.zip' },
    '.claude/skills/translate/SKILL.md':    { version: 9,   label: 'translate skill',         zip: '.claude/skills/translate.zip' },
    '.claude/skills/translation-review/SKILL.md': { version: 1, label: 'translation-review skill', zip: '.claude/skills/translation-review.zip' },
    '.claude/skills/status/SKILL.md':       { version: 10,  label: 'status skill',            zip: '.claude/skills/status.zip' },
    '.claude/skills/continuity/SKILL.md':   { version: 12,  label: 'continuity skill',        zip: '.claude/skills/continuity.zip' },
    '.claude/skills/read-aloud/SKILL.md':   { version: 10,  label: 'read-aloud skill',        zip: '.claude/skills/read-aloud.zip' },
    '.claude/skills/read-in/SKILL.md':      { version: 12,  label: 'read-in skill',           zip: '.claude/skills/read-in.zip' },
    '.claude/skills/proof-read/SKILL.md':   { version: 5,   label: 'proof-read skill',        zip: '.claude/skills/proof-read.zip' },
};

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Render a named template with the given context.
 *
 * Top-level file templates: 'claude', 'copilot', 'cursor', 'agents'
 * Skill templates: 'review', 'brainstorm', 'memory', 'translate',
 *                  'translation-review', 'status', 'continuity', 'read-aloud', 'read-in', 'proof-read'
 */
export function renderTemplate(name: string, ctx: TemplateContext): string {
    switch (name) {
        case 'claude':     return claudeMd(ctx);
        case 'copilot':    return copilotMd(ctx);
        case 'cursor':     return cursorRules(ctx);
        case 'agents':     return agentsMd(ctx);
        case 'review':     return skillReview();
        case 'brainstorm': return skillBrainstorm();
        case 'memory':     return skillMemory();
        case 'translate':  return skillTranslate();
        case 'translation-review': return skillTranslationReview();
        case 'status':     return skillStatus();
        case 'continuity': return skillContinuity();
        case 'read-aloud': return skillReadAloud();
        case 'read-in':    return skillReadIn();
        case 'proof-read': return skillProofRead();
        default:           return `Unknown template: ${name}`;
    }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function audienceNote(ctx: TemplateContext): string {
    return ctx.audience ? `Target audience: ${ctx.audience}.` : '';
}

function languageSection(ctx: TemplateContext): string {
    if (!ctx.hasMultiLang) { return ''; }
    return `\nLanguages: ${ctx.langList}.\n`;
}

// ─── Top-level templates ──────────────────────────────────────────────────────

function claudeMd(ctx: TemplateContext): string {
    const { title, author, description, genre, storyFolder, notesFolder, arcFolder } = ctx;
    const lines: string[] = [
        `# Claude — ${title}`,
        '',
        '## Project',
    ];
    if (genre)       { lines.push(`Genre: ${genre}.`); }
    if (description) { lines.push(description); }
    if (ctx.audience){ lines.push(audienceNote(ctx)); }
    if (author)      { lines.push(`Author: ${author}.`); }
    lines.push(
        languageSection(ctx),
        '## Start of session',
        '1. Use /read-in at the start of a session to load context and get your bearings.',
        '2. Run `health` from the Bindery MCP and check `ai_versions_outdated`.',
        '3. If `ai_versions_outdated` has entries, run `setup_ai_files` and present the returned `skill_zips.reupload_required` list to the user for Claude Desktop.',
        '4. If the skill or MCP server is not available, read at least COWORK.md (if present) for current focus and context.',
        '',
        '## Memory system',
        '1. When concluding a discussion, or after you give a meaningful, preservation-worthy response: use /memory to store it.',
        '2. Also when the user asks or otherwise indicates the end of a session: use /memory to save decisions.',
        '',
        '## Repo layout',
        '```',
        `${arcFolder}/  ← story arc files`,
        `${notesFolder}/  ← story notes (characters, world)`,
        `${storyFolder}/`,
        ...ctx.languages.map(l => `  ${l.folderName}/  ← ${l.code} chapters (one .md per chapter)`),
        '```',
        '',
        '## Writing rules',
        '- Never rewrite paragraphs unless explicitly asked. Suggest edits only.',
        '- HTML comments `<!-- -->` in chapter files are writer notes. Treat as context, not prose.',
        '- Quotation marks and dashes in chapter files are managed by the Bindery extension. Do not flag these as formatting errors.',
    );
    if (ctx.audience) {
        lines.push(`- Content is aimed at ${ctx.audience}. Keep language accessible and themes age-appropriate.`);
    }
    lines.push(
        '',
        '## Available skills',
        'Use these slash commands to trigger structured workflows:',
        '| Command | Purpose |',
        '|---|---|',
        '| `/review` | Review a chapter for language, arc consistency, and age-appropriateness |',
        '| `/brainstorm` | Generate plot/character/scene ideas |',
        '| `/memory` | Update memory files and compact if needed |',
        '| `/translate` | Assist with chapter translation |',
        '| `/translation-review` | Review a hand-crafted translation against the source |',
        '| `/status` | Book progress snapshot |',
        '| `/continuity` | Check a chapter for consistency errors |',
        '| `/read-aloud` | Test how a passage reads when spoken |',
        '| `/read-in` | Load context and get your bearings at the start of a session |',
        '| `/proof-read` | Read the book as multiple proofreaders and present the findings |',
        '',
        '## MCP server (bindery-mcp)',
        '',
        'All tools require a `book` argument. Use `list_books` to discover available names.',
        'Prefer these tools over Read/Bash when they apply.',
        '',
        '| Tool | What it does |',
        '|---|---|',
        '| `list_books` | List all configured book names |',
        '| `identify_book` | Match a working directory to a book name |',
        '| `health` | Server status: settings, index, embedding backend |',
        '| `init_workspace` | Create or update `.bindery/settings.json` and `translations.json` |',
        '| `setup_ai_files` | Regenerate AI instruction files, rebuild Claude skill zip files, and return a change manifest |',
        '| `index_build` | Build or rebuild the full-text search index |',
        '| `index_status` | Show index chunk count and build time |',
        '| `get_text` | Read any file by relative path, with optional line range |',
        '| `get_chapter` | Full chapter content by number and language |',
        '| `get_book_until` | Fetch chapters from 1..N (or start..N) in one call, concatenated in reading order |',
        '| `get_overview` | Chapter structure — acts, chapters, titles |',
        '| `get_notes` | Notes/ files, filterable by category or name |',
        '| `search` | BM25 full-text search with ranked snippets, optional semantic ranking |',
        '| `format` | Apply typography formatting to a file or folder |',
        '| `get_review_text` | Structured git diff with optional auto-staging |',
        '| `update_workspace` | Fetch and pull the current branch, with branch/default-branch reporting |',
        '| `git_snapshot` | Git commit of story, notes, and arc changes, with optional push |',
        '| `get_translation` | List glossary entries for a language, or look up a specific term (forgiving) |',
        '| `add_translation` | Add or update a cross-language glossary entry (agent reference, not auto-applied) |',
        '| `get_dialect` | List dialect substitution rules, or look up a specific word |',
        '| `add_dialect` | Add or update a dialect substitution rule (auto-applied at export, e.g. US→UK) |',
        '| `add_language` | Add a language to settings.json and scaffold its story folder with stubs |',
        '| `settings_update` | Merge a partial patch into settings.json without replacing unrelated keys |',
        '| `memory_list` | List `.bindery/memories/` files with line counts |',
        '| `memory_append` | Append a dated session entry to a file in `.bindery/memories/` |',
        '| `memory_compact` | Overwrite a file in `.bindery/memories/` with a summary (backs up original to `.bindery/memories/archive/`) |',
        '| `chapter_status_get` | Read the chapter progress tracker — entries grouped by status |',
        '| `chapter_status_update` | Upsert chapter progress entries (send only changed chapters) |',
    );
    return lines.filter(l => l !== '\n').join('\n') + '\n';
}

function copilotMd(ctx: TemplateContext): string {
    const { title, author, description, genre, storyFolder, notesFolder, arcFolder } = ctx;
    const lines: string[] = [`# GitHub Copilot — ${title}`, ''];
    if (genre || description || ctx.audience) {
        lines.push('## Project');
        if (genre)       { lines.push(`${genre} novel.`); }
        if (description) { lines.push(description); }
        if (ctx.audience){ lines.push(audienceNote(ctx)); }
        if (author)      { lines.push(`Author: ${author}.`); }
        lines.push(languageSection(ctx), '');
    }
    lines.push(
        '## Repo layout',
        '```',
        `${arcFolder}/  ← story arc files`,
        `${notesFolder}/  ← story bible, translation table, memories`,
        `${storyFolder}/`,
        ...ctx.languages.map(l => `  ${l.folderName}/  ← ${l.code} chapters`),
        '```',
        '',
        '## Shared skill workflows',
        '- Workspace skill files live in `.claude/skills/` and may also be picked up by agents beyond Claude.',
        '- Prefer those shared slash workflows when available: `/read-in`, `/review`, `/translation-review`, `/translate`, `/memory`, `/continuity`, `/status`, `/read-aloud`, `/proof-read`.',
        '',
        '## Writing guidelines',
        '- HTML comments `<!-- -->` in chapter files are writer notes — treat as context only.',
        '- Quotation marks and dashes are managed by the Bindery VS Code extension. Do not normalize them.',
    );
    if (ctx.audience) {
        lines.push(`- Content targets ${ctx.audience}. Keep vocabulary accessible and themes appropriate.`);
    }
    return lines.join('\n') + '\n';
}

function cursorRules(ctx: TemplateContext): string {
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

function agentsMd(ctx: TemplateContext): string {
    const { title, author, description, genre, storyFolder, notesFolder, arcFolder, memoriesFolder } = ctx;
    const lines: string[] = [`# Agent Instructions — ${title}`, ''];
    lines.push('## Project overview');
    if (genre)       { lines.push(`${genre} novel.`); }
    if (description) { lines.push(description); }
    if (ctx.audience){ lines.push(audienceNote(ctx)); }
    if (author)      { lines.push(`Author: ${author}.`); }
    lines.push(
        languageSection(ctx), 
        '',
        '## Start of session',
        `1. Read \`${memoriesFolder}/global.md\` for cross-chapter context.`,
        `2. If working on a specific chapter, read \`${memoriesFolder}/chXX.md\` if it exists.`,
        '3. Check `.claude/skills/` for shared slash workflows before improvising a bespoke process.',
        '',
        '## Story files',
        `- Chapter files are \`.md\` files in \`${storyFolder}/\`, organized in act subfolders.`,
        '- HTML comments `<!-- -->` are writer notes — treat as context only, not prose.',
        '- Quotation marks and em-dashes are managed by the Bindery extension. Do not normalize them.',
        '',
        '## Shared skill workflows',
        '- Shared workflows live in `.claude/skills/` and can be used by agents beyond Claude when the runtime supports workspace skills.',
        '- Prefer `/read-in`, `/review`, `/translation-review`, `/translate`, `/memory`, `/continuity`, `/status`, `/read-aloud`, and `/proof-read` when the user is asking for one of those structured tasks.',
        '',
        '## Writing guidelines',
        '- Do not rewrite paragraphs unless explicitly asked. Suggest edits only.',
    );
    if (ctx.audience) {
        lines.push(`- Audience is ${ctx.audience}. Keep vocabulary clear and themes age-appropriate.`);
    }
    lines.push(
        '',
        '## Key reference files',
        '| File | Contains |',
        '|---|---|',
        `| \`${arcFolder}/\` | Story arc files for overall and per-act structure and beats |`,        
        `| \`${notesFolder}/\` | Story notes, like character profiles and world rules |`,
        `| \`${memoriesFolder}/global.md\` | Cross-session decisions |`,
    );
    return lines.join('\n') + '\n';
}

// ─── Skill templates ──────────────────────────────────────────────────────────
// Skills are Bindery workspaces designed for specific writing tasks, triggered by slash commands. They include step-by-step instructions and recommended MCP tools to use.
// For new skills: make sure to add the prerequisites section, and update FILE_VERSION_INFO with a new version and label.

function skillReview(): string {
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
- \`get_review_text(autoStage: true, contextLines: 3)\` — get the git diff of uncommitted changes, auto-staged for review. Pass more contextLines when join points to existing prose need checking
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

function skillBrainstorm(): string {
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

function skillMemory(): string {
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

function skillTranslate(): string {
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

function skillTranslationReview(): string {
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
- \`get_review_text(autoStage: true, contextLines: 3)\` — get the git diff of uncommitted changes, auto-staged for review. Pass more contextLines when join points to existing prose need checking
- \`get_text(identifier, startLine?, endLine?)\` — fetch matching source lines or focused ranges
- \`get_translation(targetLanguage)\` — load glossary terms for the target language before reviewing
- \`get_chapter(chapterNumber, language)\` — full chapter source/target pair for full spot-check mode
- \`search(query, targetLanguage)\` — verify how a term was used in previously translated chapters before flagging it
- \`add_translation(targetLanguage, from, to)\` — persist a confirmed glossary correction

## Mode 1 - Scoped diff review (primary)

### Steps

1. Call \`get_review_text\`.
2. If the diff is empty, report that nothing new has been translated yet.
3. Identify changed files and determine source/target language from available context: session file (for example COWORK.md), recent conversation, or ask the user if ambiguous.
4. If the target-language file changed, capture the changed target line range.
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

function skillStatus(): string {
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

function skillContinuity(): string {
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

function skillReadAloud(): string {
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

function skillReadIn(): string {
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

function skillProofRead(): string {
    return `---
name: proof-read
description: Bindery workspace - Multi-perspective proofreading using isolated reader and author personas. Each persona runs as a scoped subagent with no arc, notes, or memory context — only the reading-text payload for the read-so-far experience (chapters 1..N). Use for /proof-read, "proofread chapter X", "get reader feedback", "how does this land with readers", "simulate reader reactions", or "peer review".
---
# Skill: /proof-read

Simulates a panel of readers reviewing a chapter as genuine first-time readers — no arc knowledge, no notes, no memory of prior sessions. Each persona runs as an isolated subagent that only sees the reading-text payload so far (chapters 1..N) and their assigned role.

The value is in the isolation. A reader doesn't know what the arc says should happen, what a character's backstory is, or what the chapter was *trying* to do. That's exactly the feedback you can't give yourself, and can't get from an agent that has been working on the book with you.

## Prerequisites
This skill requires a Bindery workspace. If unsure, call \`identify_book\` to check.

## Trigger
User says \`/proof-read\`, "proofread chapter X", "get reader feedback", "how does this land with readers", "simulate reader reactions", or "peer review".

## Steps

### Step 0: Load project context

Before asking the user anything, read the project settings:

\`\`\`
get_text(".bindery/settings.json")
\`\`\`

Extract:
- \`targetAudience\` — used to calibrate reader personas (age, reading level)
- \`genre\` — used to construct the genre-fan persona and to generate author suggestions if needed
- \`proof_read.authors\` — the stored author panel for this project (may be absent)

If \`settings.json\` has no \`proof_read\` section yet, that's expected on first run — handle it in the author setup step below.

### Step 1: Author panel setup

**If \`proof_read.authors\` is set:**
Present the stored authors and confirm:
> "I have [Author A], [Author B], and [Author C] saved for this project. Shall I use them, or would you like to change the panel?"

If the user wants to change: follow the "no authors stored" flow below, then update settings.

**If \`proof_read.authors\` is not set (first run):**
Ask:
> "No author panel configured yet for this project. Would you like suggestions based on the genre, or do you have specific writers in mind?"

- If **suggestions**: generate 4-5 relevant author names based on the book's genre, audience, and tone (see Author Suggestions below). Present them with a one-line description each. Let the user pick 2–3.
- If **own names**: accept the user's list as-is.

Once the panel is confirmed, store it back to settings:

\`\`\`
settings_update({ patch: { proof_read: { authors: [ { name: "...", known_for: "...", reads_for: "..." } ] } } })
\`\`\`

The \`reads_for\` field is a short phrase describing what this author's lens brings — e.g. "pacing of reveals, handling of danger for the age group". Generate it at storage time so it's available for subagent prompts without needing a web lookup later.

### Step 2: Gather remaining parameters

Ask:
1. Which chapter to focus on — or the whole book?
2. Quick run (2 readers + 1 author) or full run (all 4 readers + full author panel)?

If the user invoked \`/proof-read 7\` or similar, the focus chapter is known — no need to ask.

### Step 3: Fetch the reading context

A real reader arrives at chapter N having read everything before it. Subagents receive the full text from chapter 1 up to and including the focus chapter — not a summary, not just the target chapter in isolation.

**Why not a summary of prior chapters?** Any summary written by an agent who has worked on the book will carry arc knowledge — framing, foreshadowing, loaded context. It biases the subagent in ways a real reader wouldn't be. Full text preserves the isolation.

**Why not have subagents call MCP themselves?** Subagents with MCP access could accidentally pull notes, arc files, or overviews. Using a pre-written staging file and passing only that payload to subagents reduces that risk and is the best available way in this workflow to keep them focused on reader-visible text.

Use \`get_book_until(chapterNumber: n, language)\` to fetch all prior chapters in one call. If unavailable, loop \`get_chapter(1)\` through \`get_chapter(n)\` in the main agent. For a **whole-book** run, fetch all chapters.

Once the text is retrieved, **write it to a staging file**:
\`.bindery/proof-read-payload.md\`

If the file already exists from a previous run, overwrite it.

Modern context windows handle full books comfortably — a 20-chapter 12+ novel is roughly 60-80k words, well within range.

### Step 4: Spawn all subagents in a single turn

Launch all persona subagents in parallel. Each receives:
- Their persona description (constructed from project context — see Reader Personas and Author Personas below)
- The path to the staging file written in Step 3
- The review task (see Review Task Template) — which instructs them to read the staging file as their **only** file access
- An explicit reminder that they have no prior knowledge of this book beyond what they read from that file

### Step 5: Aggregate

Once all subagents return, aggregate across the full panel:

1. **Consensus positives** — moments or elements praised by a multitude of readers. These are your strongest material.
2. **Consensus issues** — problems flagged by a multitude of readers. Highest priority to address.
3. **Notable divergences** — where one reader type loved something another didn't. Not automatically a problem, but a useful creative signal (e.g. a core reader engaged by a worldbuilding passage that lost the reluctant reader).
4. **Author notes** — surface separately. These are craft-level observations, not reader reactions, and shouldn't be averaged against them.

Present individual reactions first (summarised), then the aggregated view. Close with a short prioritised action list.

---

## Reader Personas

Reader personas are constructed from the project's \`targetAudience\` and \`genre\` settings — do not hardcode ages or genre references. Use the actual values from settings.

The four reader roles stay stable, but R1 and R3 should be chosen relative to the book's genre rather than treated as fixed labels:

**R1 — Core Reader**
A reader at the target age who actively seeks out this kind of book. If the project is fantasy, this is a fantasy reader; if it is realistic contemporary fiction, this is a realistic-fiction reader. They know what this corner does well, enjoy its native pleasures, and notice quickly when the execution is strong or weak.

**R2 — Curious Reader**
A reader at the target age who reads regularly but not primarily in this genre. Open and engaged, but reacts as an outsider to genre conventions.

**R3 — Opposite-Corner Reader**
A reader at the target age whose tastes pull away from the book's home genre. Their job is to test whether the text still works for someone who does not naturally prize this genre's default strengths. For fantasy, this might be a realism-first reader who cares most about emotional plausibility and character grounding. For realistic fiction, it should be a reader from a different corner, such as mystery, thriller, romance, horror, or speculative fiction, who wants a stronger external hook or a different kind of momentum.

**R4 — Reluctant Reader**
A reader at the target age who reads when they have to. Will notice immediately if something drags or confuses. Short patience for exposition. Will find genuine excitement if it's there — but won't invent it.

When building the subagent prompt, fill in the actual age range and genre from settings. Choose R3 as the deliberate contrast to the project's genre, not always as "the realist". For example, if \`targetAudience\` is "12+" and \`genre\` is "sci-fi/fantasy crossover", R1 becomes: *"You are 12-13 years old. You read a lot and you love sci-fi and fantasy..."* If the genre is realistic contemporary fiction, R3 should instead come from a different reading corner, such as mystery, thriller, or speculative fiction.

---

## Author Personas

Author personas come from \`proof_read.authors\` in settings. Each entry has \`name\`, \`known_for\`, and \`reads_for\`. Use these fields directly in the subagent prompt — no need to reconstruct them.

### Author Suggestions

When the user asks for suggestions, generate a shortlist of 4-5 authors whose work overlaps meaningfully with the book's genre, tone, and target audience. Good criteria:

- Writes for approximately the same age group
- Works in the same genre or a closely adjacent one
- Has a distinctive craft lens that adds something different from the others (e.g. one known for worldbuilding, one for pacing, one for character voice)
- Ideally at least one who writes in a "neighbouring" genre (e.g. for a fantasy book, a post-apocalyptic author) to get an outside-genre craft read

Present each suggestion with: name, one well-known title, and what their lens would add to the review.

---

## Review Task Template

For **reader personas**:

> You are [PERSONA DESCRIPTION built from project settings].
>
> You are reading [TARGET CHAPTER OR BOOK] from a [GENRE] novel aimed at [TARGET AUDIENCE] readers. You have no prior knowledge of this book — no plot summaries, no character guides, no notes. You are reading this cold, exactly as you would if you'd just picked it up.
> [CHAPTER NOTE: if the focus is a single chapter, say, "you read up to and including chapter N, focus your feedback on chapter N"]
>
> The text is in the file at: \`[STAGING FILE PATH]\`
> Read that file using the \`read_file\` tool. **That is the only file you may access.** Do not call any other tool, MCP server, or external resource.
>
> Give your honest reaction as this reader. Cover:
> 1. Your overall impression (1-2 sentences)
> 2. Moments that worked — where you were engaged, what you enjoyed
> 3. Moments that didn't land — confusion, slow patches, anything that pulled you out
> 4. Characters: did they feel real? Did you care what happened to them?
> 5. Specific lines or passages worth flagging (positive or negative) — quote them
> 6. Would you keep reading? Why or why not?
>
> Be specific. Quote the text when it helps. Do not summarise the plot — react to it.

For **author personas**:

> You are reading this book as [AUTHOR NAME], author of [KNOWN_FOR], giving peer feedback to a fellow writer. The book is aimed at [TARGET AUDIENCE] readers. You have no prior knowledge of the manuscript beyond this text.
> [CHAPTER NOTE: if the focus is a single chapter, say, "you read up to and including chapter N, focus your feedback on chapter N"]
>
> Your particular focus: [READS_FOR].
>
> The manuscript is in the file at: \`[STAGING FILE PATH]\`
> Read that file using the \`read_file\` tool. **That is the only file you may access.** Do not call any other tool, MCP server, or external resource.
>
> Give craft-level feedback: what's working and why, what isn't and how you'd think about fixing it. Voice, pacing, structure, dialogue, the handling of tension. Quote the text when useful. Be honest — this is peer review, not encouragement.

---

## Output Format

\`\`\`
## Proof-read: [Book title if available] / Chapter [N] — [Chapter title if available]

### Reader reactions

**R1 — Core reader**
[2-3 sentence summary. Key quote if strong.]

**R2 — Curious reader**
...

**R3 — Opposite-corner reader**
...

**R4 — Reluctant reader**
...

### Author peer review

**[Author name]** ([known_for, short])
[Craft observations, 3-4 sentences]

...

### What landed (consensus — 3+ readers)
- [Specific moment or element] — flagged by [names]
- ...

### What needs attention (consensus — 3+ readers)
- [Issue] — flagged by [names]
- ...

### Divergences worth noting
- [Element] resonated with core readers but lost the opposite-corner / reluctant reader
- ...

### Suggested actions
1. [Highest priority]
2. ...
\`\`\`

---

## Quick Run

For a faster pass: **R1** (core reader), **R4** (reluctant reader), and the first stored author. Two reader extremes plus a craft read — widest spread with fewest subagents.

---

## Notes for the agent

- **Never** give subagents MCP access. The calling agent should write the reading text to \`.bindery/proof-read-payload.md\` and have subagents work only from that staged file. This reduces the risk of them pulling arc files, notes, or overviews, but treat it as a best-effort workflow unless access restrictions are enforced by the runtime.
- **Staging file:** overwrite it fresh each run so stale text from a previous session never bleeds in.
- **Multiple chapters:** Run each chapter as a separate parallel batch. Aggregate per chapter first, then offer a cross-chapter summary if the user asks.
- **Cost awareness:** Full run is 7 subagent calls per chapter (4 readers + 3 authors). Mention this if the user hasn't specified quick vs. full, especially for longer chapters.
- **Divergences are data, not problems.** A passage that splits readers along genre-familiarity lines might be exactly right for this book. Surface it, let the author decide.
- **Author panel changes:** If the user swaps authors mid-session, update \`proof_read.authors\` in settings before running so the change persists.`;
}
