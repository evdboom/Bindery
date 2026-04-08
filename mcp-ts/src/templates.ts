/**
 * Bindery AI instruction file templates.
 *
 * SINGLE SOURCE OF TRUTH — do not edit the copy in vscode-ext/src/.
 * The copy at vscode-ext/src/ai-setup-templates.ts is generated automatically:
 *   cp mcp-ts/src/templates.ts vscode-ext/src/ai-setup-templates.ts
 *
 * This file has zero imports. It exports only TemplateContext and renderTemplate.
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

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Render a named template with the given context.
 *
 * Top-level file templates: 'claude', 'copilot', 'cursor', 'agents'
 * Skill templates: 'review', 'brainstorm', 'memory', 'translate',
 *                  'status', 'continuity', 'read_aloud', 'read_in'
 */
export function renderTemplate(name: string, ctx: TemplateContext): string {
    switch (name) {
        case 'claude':     return claudeMd(ctx);
        case 'copilot':    return copilotMd(ctx);
        case 'cursor':     return cursorRules(ctx);
        case 'agents':     return agentsMd(ctx);
        case 'review':     return skillReview(ctx);
        case 'brainstorm': return skillBrainstorm(ctx);
        case 'memory':     return skillMemory(ctx);
        case 'translate':  return skillTranslate(ctx);
        case 'status':     return skillStatus(ctx);
        case 'continuity': return skillContinuity(ctx);
        case 'read_aloud': return skillReadAloud(ctx);
        case 'read_in':    return skillReadIn(ctx);
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
    const { title, author, description, genre, storyFolder, notesFolder, arcFolder, memoriesFolder } = ctx;
    const lines: string[] = [
        `# Claude — ${title}`,
        '',
        '## Project',
    ];
    if (genre)       { lines.push(`Genre: ${genre}.`); }
    if (description) { lines.push(description); }
    if (ctx.audience){ lines.push(audienceNote(ctx)); }
    if (author)      { lines.push(`Author: ${author}.`); }
    lines.push(languageSection(ctx));

    lines.push(
        '## Start of session',
        '1. Use /read-in at the start of a session to load context and get your bearings.',
        '2. Run `health` and check `ai_versions_outdated`.',
        '3. If `ai_versions_outdated` has entries, run `setup_ai_files` and present the returned `skill_zips.reupload_required` list to the user for Claude Desktop.',
        '4. If the skill is not available, read at least COWORK.md (if present) for current focus and context.',
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
        '| `/status` | Book progress snapshot |',
        '| `/continuity` | Check a chapter for consistency errors |',
        '| `/read-aloud` | Test how a passage reads when spoken |',
        '| `/read-in` | Load context and get your bearings at the start of a session |',
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
        '| `get_overview` | Chapter structure — acts, chapters, titles |',
        '| `get_notes` | Notes/ and Details_*.md files, filterable by category or name |',
        '| `search` | BM25 full-text search with ranked snippets |',
        '| `retrieve_context` | Semantic passage retrieval for "where did X happen" queries |',
        '| `format` | Apply typography formatting to a file or folder |',
        '| `get_review_text` | Structured git diff with optional auto-staging |',
        '| `git_snapshot` | Git commit of story, notes, and arc changes |',
        '| `get_translation` | List glossary entries for a language, or look up a specific term (forgiving) |',
        '| `add_translation` | Add or update a cross-language glossary entry (agent reference, not auto-applied) |',
        '| `get_dialect` | List dialect substitution rules, or look up a specific word |',
        '| `add_dialect` | Add or update a dialect substitution rule (auto-applied at export, e.g. US→UK) |',
        '| `add_language` | Add a language to settings.json and scaffold its story folder with stubs |',
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
        '## Writing guidelines',
        '- HTML comments `<!-- -->` in chapter files are writer notes — treat as context only.',
        '- Quotation marks and dashes are managed by the Bindery VS Code extension. Do not normalize them.',
        '- Check `Notes/Details_Translation_notes.md` before using or translating world-specific terms.',
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
        `- \`${arcFolder}/Overall.md\` — full story arc`,
        `- \`${notesFolder}/Details_Characters.md\` — character profiles`,
        `- \`${notesFolder}/Details_World_and_Magic.md\` — world rules`,
        `- \`${notesFolder}/Details_Translation_notes.md\` — term translations`,
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
    lines.push(languageSection(ctx), '');
    lines.push(
        '## Start of session',
        `1. Read \`${memoriesFolder}/global.md\` for cross-chapter context.`,
        `2. If working on a specific chapter, read \`${memoriesFolder}/chXX.md\` if it exists.`,
        `3. Check \`${notesFolder}/Details_Translation_notes.md\` before using or translating world-specific terms.`,
        '',
        '## Story files',
        `- Chapter files are \`.md\` files in \`${storyFolder}/\`, organized in act subfolders.`,
        '- HTML comments `<!-- -->` are writer notes — treat as context only, not prose.',
        '- Quotation marks and em-dashes are managed by the Bindery extension. Do not normalize them.',
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
        `| \`${arcFolder}/Overall.md\` | Full story arc |`,
        `| \`${arcFolder}/Act_I_*.md\`, \`Act_II_*.md\`, \`Act_III_*.md\` | Per-act arc details |`,
        `| \`${notesFolder}/Details_Characters.md\` | Character profiles |`,
        `| \`${notesFolder}/Details_World_and_Magic.md\` | World rules |`,
        `| \`${notesFolder}/Details_Translation_notes.md\` | EN ↔ translation term table |`,
        `| \`${memoriesFolder}/global.md\` | Cross-session decisions |`,
    );
    return lines.join('\n') + '\n';
}

// ─── Skill templates ──────────────────────────────────────────────────────────

function skillReview(ctx: TemplateContext): string {
    const { title, arcFolder, memoriesFolder } = ctx;
    const audienceStr = ctx.audience || 'the target audience';
    return `---
name: Review
description: Review a chapter of "${title}" for language, arc consistency, and age-appropriateness. Use for /review, "review chapter X", "quick review", or "review my changes".
---

# Skill: /review

Review a chapter of "${title}" and give structured feedback.

## Trigger
User says \`/review\`, "review chapter X", "quick review", or "review my changes".

## Clarify first
- Which chapter number?
- Type: **Full** (language + arc + age-appropriateness) or **Quick** (language and typos only)?

## Tools
Use these Bindery MCP tools to gather context:
- \`get_review_text(language)\` — get the git diff of uncommitted changes (for "review my changes")
- \`get_chapter(chapterNumber, language)\` — read the full chapter text
- \`get_notes(category, name)\` — look up character profiles (\`category: "Characters"\`) or world rules
- \`retrieve_context(query, language)\` — find related passages across the book
- \`git_snapshot(message)\` — after a successful review, suggest saving a snapshot

## Steps

### 1. Load context
- Read \`${memoriesFolder}/global.md\`
- Use \`get_chapter\` to load the chapter
- For a Full review, read the relevant arc file: \`${arcFolder}/Act_I_[X].md\`, \`Act_II_[X].md\`, or \`Act_III_[X].md\`
- For "review my changes", use \`get_review_text\` to get the diff

### 2. Perform the review

**Quick** — language and typos only.

**Full** — adds:
- Arc consistency with the arc file
- Age-appropriateness for ${audienceStr}
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

function skillBrainstorm(ctx: TemplateContext): string {
    const { title, arcFolder, memoriesFolder } = ctx;
    const audienceStr = ctx.audience || 'the target audience';
    return `---
name: Brainstorm
description: Brainstorm story ideas, plot beats, character moments, or scene concepts for "${title}". Use for /brainstorm, "I'm stuck", "help me think of ideas", or "Am I stuck?".
---

# Skill: /brainstorm

Brainstorm story ideas, character moments, or plot solutions for "${title}".

## Trigger
User says \`/brainstorm\`, "I'm stuck", "help me think of ideas", or "Am I stuck?".

## Clarify first
- Focus: plot beat / character moment / scene idea / chapter opening-closing?
- Which chapter or story point?
- Any constraints to respect?

## Tools
Use these Bindery MCP tools to gather context:
- \`retrieve_context(query, language)\` — find thematic parallels and related moments across the book
- \`get_notes(category, name)\` — look up character profiles, world rules, or equipment details
- \`get_chapter(chapterNumber, language)\` — read a specific chapter for reference

## Steps

1. Read \`${memoriesFolder}/global.md\` and the relevant arc file from \`${arcFolder}/\`.
2. If character-focused, use \`get_notes(category: "Characters")\` for character profiles.
3. Use \`retrieve_context\` to find related moments or themes already in the book.
4. Generate 3-5 concrete ideas that fit the arc and feel true to the characters.

## Output format

**Option A — [short title]**
[3-5 sentence description]

...

End with a brief note on which options feel most aligned with the arc.

## Rules
- Respect established world rules and character voices
- Keep ideas appropriate for ${audienceStr}
`;
}

function skillMemory(ctx: TemplateContext): string {
    return `---
name: Memory
description: Save session decisions to persistent memory files using Bindery MCP tools. Use for /memory, "save this to memory", "update memories", or at end of session.
---

# Skill: /memory

Update project memory files with decisions from the current session.

## Trigger
User says \`/memory\`, "save this to memory", "update memories", or at session end.

## Tools
Use these Bindery MCP tools:
- \`memory_list\` — discover which memory files exist and their line counts
- \`memory_append(file, title, content)\` — append a dated session entry; the tool stamps the date automatically
- \`memory_compact(file, compacted_content)\` — overwrite a file with a summary; backs up the original to \`archive/\` automatically
- \`git_snapshot(message)\` — after updating memories, offer to save a snapshot

## Steps

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

function skillTranslate(ctx: TemplateContext): string {
    return `---
name: Translate
description: Translate a chapter or spot-check an existing translation using the Bindery translation table. Use for /translate, "translate chapter X", or "help me with the translation".
---

# Skill: /translate

Translate a chapter or passage into the target language.

## Trigger
User says \`/translate\`, "translate chapter X", or "help me with the translation".

## Clarify first
- Which chapter number and target language?
- Full translation or spot-check an existing translation?

## Tools
Use these Bindery MCP tools:
- \`get_chapter(chapterNumber, language)\` — read a chapter in any language (source or existing translation)
- \`get_translation(language)\` — list glossary entries for a target language (e.g. \`"nl"\`)
- \`get_translation(language, word)\` — look up a specific term; forgiving: case-insensitive, handles plurals and inflected forms
- \`get_dialect(dialectCode)\` — list dialect substitution rules (e.g. \`"en-gb"\`)
- \`search(query, language)\` — verify how a term was rendered in other translated chapters
- \`add_translation(targetLangCode, from, to)\` — save a new glossary term pair when the user confirms a translation choice
- \`add_dialect(dialectCode, from, to)\` — save a spelling substitution rule (e.g. US→UK) applied automatically at export

## Steps

### 1. Load the translation table
Call \`get_translation(language)\` to load all known glossary term mappings for the target language before translating anything.

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

function skillStatus(ctx: TemplateContext): string {
    const { arcFolder, memoriesFolder } = ctx;
    return `---
name: Status
description: Give a book progress snapshot — chapters done, in progress, and coming up. Use for /status, "what's the book status", or "where are we".
---

# Skill: /status

Snapshot of the book's progress: what's done, in progress, and coming up.

## Trigger
User says \`/status\`, "what's the book status", or "where are we".

## Tools
Use these Bindery MCP tools:
- \`chapter_status_get(book)\` — read the structured progress tracker from \`.bindery/chapter-status.json\`
- \`chapter_status_update(book, chapters)\` — upsert chapter progress entries (send only changed chapters)
- \`get_overview(language)\` — list all acts and chapters with titles
- \`get_text(identifier)\` — read COWORK.md and \`${memoriesFolder}/global.md\`
- \`memory_list\` — discover which chapter memory files exist (\`chXX.md\`)

## Steps

1. Use \`chapter_status_get\` to read the current tracker. Use \`memory_list\` to check available memory files. Use \`get_text\` to read COWORK.md (current focus) and \`${memoriesFolder}/global.md\`.
2. Use \`get_overview\` for the full chapter listing if the tracker is empty or incomplete.
3. Check \`${arcFolder}/\` for what's planned vs written (Overall.md + the relevant act file).
4. Output: overall count / done / in-progress / coming up (next 2-3 chapters) / open questions.
5. If the tracker is out of date or missing entries, update it with \`chapter_status_update\` (upsert only the changed chapters).

## Output
Keep it scannable — bold headers, short lines. This is a working tool, not a narrative summary.
`;
}

function skillContinuity(ctx: TemplateContext): string {
    const { memoriesFolder } = ctx;
    return `---
name: Continuity
description: Cross-check a chapter for consistency errors in characters, world rules, or timeline. Use for /continuity, "check continuity", or "check chapter X for errors".
---

# Skill: /continuity

Cross-check a chapter for consistency errors.

## Trigger
User says \`/continuity\`, "check continuity", or "check chapter X for errors".

## Clarify first
- Chapter number?
- Focus: All / Characters / World rules / Timeline?

## Tools
Use these Bindery MCP tools:
- \`get_chapter(chapterNumber, language)\` — read the chapter (and previous chapter for timeline checks)
- \`get_notes(category, name)\` — look up character profiles or world rules
- \`retrieve_context(query, language)\` — find earlier mentions of a character detail or event
- \`search(query, language)\` — exact-match search for names, places, or specific terms
- \`memory_list\` — check whether a chapter-specific memory file exists (\`chXX.md\`)

## Steps

1. Use \`get_chapter\` to read the chapter.
2. Use \`get_text\` to read \`${memoriesFolder}/global.md\`. Use \`memory_list\` to check if a chapter-specific memory file (\`chXX.md\`) exists; if so, read it with \`get_text\` too. Use \`get_notes(category: "Characters")\` for character profiles.
3. For world rules: use \`get_notes(category: "World")\`.
4. For timeline: also use \`get_chapter\` to read the previous chapter.
5. Use \`retrieve_context\` or \`search\` to verify specific details against earlier chapters.

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

function skillReadAloud(ctx: TemplateContext): string {
    const audienceStr = ctx.audience || 'the target audience';
    return `---
name: Read Aloud
description: Test how a chapter or passage sounds when read aloud — flags long sentences, staccato rhythm, complex vocabulary, and said-bookisms. Use for /read-aloud, "reading test", or "how does this sound".
---

# Skill: /read-aloud

Test how a chapter sounds when read aloud to ${audienceStr}.

## Trigger
User says \`/read-aloud\`, "reading test", or "how does this sound".

## Clarify first
- Whole chapter or specific passage?

## Tools
Use these Bindery MCP tools:
- \`get_chapter(chapterNumber, language)\` — read the full chapter
- \`get_text(identifier, startLine, endLine)\` — read a specific passage by line range

## What to check
- Sentences over ~30 words
- Sequences of 3+ short sentences (staccato)
- Vocabulary too complex for ${audienceStr}
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

function skillReadIn(ctx: TemplateContext): string {
    const { memoriesFolder } = ctx;
    return `---
name: Read-in
description: Load project context at the start of a session — memory, progress tracker, and chapter notes. Use for /read-in, "get your bearings", "what were we doing", or at the start of any working session.
---

# Skill: /read-in

Load context and get your bearings before starting work.

## Trigger
User says \`/read-in\`, "get your bearings", "what were we working on", or at the start of a session.

## Tools
Use these Bindery MCP tools:
- \`memory_list\` — discover which memory files exist (\`global.md\`, \`chXX.md\` files)
- \`get_text(identifier)\` — read COWORK.md and memory files
- \`chapter_status_get(book)\` — read the structured progress tracker
- \`get_overview(language)\` — list all acts and chapters (only if tracker is empty or sparse)

## Steps

### 1. Check for current focus
Use \`get_text("COWORK.md")\` to read the current focus file (ignore if missing).

### 2. Load global memory
Use \`memory_list\` to discover available memory files, then \`get_text("${memoriesFolder}/global.md")\` to load cross-chapter decisions.

### 3. Read the progress tracker
Use \`chapter_status_get\` to read current chapter progress. If it is empty or has fewer than 3 entries, also call \`get_overview\` for the full chapter listing.

### 4. Determine working chapter
If COWORK.md names a chapter, use that.
Otherwise if the tracker has a single \`in-progress\` chapter, use that.
Otherwise — **ask the user**: "Which chapter do you want to work on?"

### 5. Load chapter memory
Once the chapter is known (e.g. chapter 10), check \`memory_list\` output for a matching file (\`ch10.md\`). If it exists, read it with \`get_text("${memoriesFolder}/ch10.md")\`.

### 6. Summarize
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
