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
 *                  'status', 'continuity', 'read_aloud'
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
        `1. Read COWORK.md (if present) for current focus and context.`,
        `2. Read ${memoriesFolder}/global.md for cross-chapter decisions.`,
        `3. If working on a specific chapter, read ${memoriesFolder}/chXX.md if it exists.`,
        '',
        '## Repo layout',
        '```',
        `${arcFolder}/  ← story arc files (Overall.md, Act_I_*.md, Act_II_*.md, Act_III_*.md)`,
        `${notesFolder}/  ← story bible (characters, world, translation table, memories)`,
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
        '## Key reference files',
        '| File | Contains |',
        '|---|---|',
        `| \`${arcFolder}/Overall.md\` | Full story arc |`,
        `| \`${arcFolder}/Act_I_*.md\`, \`Act_II_*.md\`, \`Act_III_*.md\` | Per-act arc details |`,
        `| \`${notesFolder}/Details_Characters.md\` | Character profiles |`,
        `| \`${notesFolder}/Details_World_and_Magic.md\` | World rules and magic system |`,
        `| \`${notesFolder}/Details_Translation_notes.md\` | Term translations / glossary |`,
        `| \`${memoriesFolder}/global.md\` | Cross-session decisions |`,
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
        '- Quotation marks and dashes are managed by the Bindery VS Code extension. Do not normalise them.',
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
        '- Do not normalise quotation marks or dashes — these are managed by the Bindery extension.',
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
        `- Chapter files are \`.md\` files in \`${storyFolder}/\`, organised in act subfolders.`,
        '- HTML comments `<!-- -->` are writer notes — treat as context only, not prose.',
        '- Quotation marks and em-dashes are managed by the Bindery extension. Do not normalise them.',
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
- \`title\`: short topic label, e.g. \`"Daeven introduction — character decisions"\`
- \`content\`: the decisions to record, one per line

The tool stamps the current date. Do not add a date to the content.

### 4. Compact if needed
If \`memory_list\` shows a file exceeding ~150 lines, offer to compact it:
- Summarise the existing content into a concise replacement
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
- \`get_translation(language)\` — list all rules for a language key (e.g. \`"nl"\` or \`"en-gb"\`)
- \`get_translation(language, word)\` — look up a specific term; forgiving: case-insensitive, handles plurals and inflected forms
- \`search(query, language)\` — verify how a term was rendered in other translated chapters
- \`add_translation(langKey, from, to)\` — save a new term pair to \`.bindery/translations.json\` when the user confirms a translation choice

## Steps

### 1. Load the translation table
Call \`get_translation(language)\` to load all known term mappings for the target language before translating anything.

### 2. Load the chapter
Use \`get_chapter(chapterNumber, sourceLanguage)\` to read the source chapter.
For spot-check mode, also call \`get_chapter(chapterNumber, targetLanguage)\` to read the existing translation.

### 3. Translate or review
**Full translation** — translate paragraph by paragraph, applying all terms from the glossary. Output the full result in a fenced \`\`\`markdown block for easy pasting.

**Spot-check** — compare source and translation side-by-side. Use a feedback table:

| Location | Source | Current translation | Suggestion | Reason |
|---|---|---|---|---|

### 4. Save confirmed terms
When the user confirms a new or corrected term translation, call \`add_translation\` to persist it so future exports apply it automatically.

## Rules
- Always load the translation table first — never invent translations for world-specific terms
- Flag uncertain terms rather than guessing
`;
}

function skillStatus(ctx: TemplateContext): string {
    const { notesFolder, arcFolder, memoriesFolder } = ctx;
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
- \`get_overview(language)\` — list all acts and chapters with titles
- \`get_text(identifier)\` — read COWORK.md, \`${notesFolder}/Chapter_Status.md\`, and \`${memoriesFolder}/global.md\`
- \`memory_list\` — discover which chapter memory files exist (\`chXX.md\`)

## Steps

1. Use \`memory_list\` to check available memory files. Use \`get_text\` to read COWORK.md (current focus), \`${notesFolder}/Chapter_Status.md\`, and \`${memoriesFolder}/global.md\`.
2. Use \`get_overview\` for the full chapter listing.
3. Check \`${arcFolder}/\` for what's planned vs written (Overall.md + the relevant act file).
4. Output: overall count / done / in-progress / coming up (next 2-3 chapters) / open questions.

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
