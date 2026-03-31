/**
 * Bindery — AI assistant setup
 *
 * Generates AI assistant instruction files and Claude skill templates from
 * the project's .bindery/settings.json. Each target produces different files:
 *
 *   claude    → CLAUDE.md + .claude/skills/<skill>/SKILL.md
 *   copilot   → .github/copilot-instructions.md
 *   cursor    → .cursor/rules
 *   agents    → AGENTS.md  (OpenAI Agents, Aider, Codex, etc.)
 */

import * as fs   from 'fs';
import * as path from 'path';
import type { WorkspaceSettings } from './workspace';
import type { LanguageConfig }    from './merge';

// ─── Public types ─────────────────────────────────────────────────────────────

export type AiTarget = 'claude' | 'copilot' | 'cursor' | 'agents';

export interface AiSetupOptions {
    root:        string;
    settings:    WorkspaceSettings;
    targets:     AiTarget[];
    /** Skills to generate for the claude target. */
    skills?:     SkillTemplate[];
    /** Overwrite existing files? Default false (skip existing). */
    overwrite?:  boolean;
}

export interface AiSetupResult {
    created:  string[];   // files created
    skipped:  string[];   // files that existed and were not overwritten
}

export type SkillTemplate =
    | 'review'
    | 'brainstorm'
    | 'memory'
    | 'translate'
    | 'status'
    | 'continuity'
    | 'read_aloud';

export const ALL_SKILLS: SkillTemplate[] = [
    'review', 'brainstorm', 'memory', 'translate', 'status', 'continuity', 'read_aloud',
];

// ─── Entry point ──────────────────────────────────────────────────────────────

export function setupAiFiles(options: AiSetupOptions): AiSetupResult {
    const { root, settings, targets, skills = ALL_SKILLS, overwrite = false } = options;
    const result: AiSetupResult = { created: [], skipped: [] };

    const ctx = buildContext(settings);

    for (const target of targets) {
        switch (target) {
            case 'claude':
                writeFile(root, 'CLAUDE.md',                        claudeMd(ctx),        overwrite, result);
                for (const skill of skills) {
                    const skillDir = path.join('.claude', 'skills', skill);
                    writeFile(root, path.join(skillDir, 'SKILL.md'), skillMd(skill, ctx), overwrite, result);
                }
                break;

            case 'copilot':
                writeFile(root, path.join('.github', 'copilot-instructions.md'), copilotMd(ctx), overwrite, result);
                break;

            case 'cursor':
                writeFile(root, path.join('.cursor', 'rules'), cursorRules(ctx), overwrite, result);
                break;

            case 'agents':
                writeFile(root, 'AGENTS.md', agentsMd(ctx), overwrite, result);
                break;
        }
    }

    return result;
}

// ─── Template context ─────────────────────────────────────────────────────────

interface TemplateContext {
    title:         string;
    author:        string;
    description:   string;
    genre:         string;
    audience:      string;
    storyFolder:   string;
    notesFolder:   string;
    arcFolder:     string;
    languages:     LanguageConfig[];
    langList:      string;    // e.g. "EN (source), NL (translation)"
    hasMultiLang:  boolean;
}

function buildContext(s: WorkspaceSettings): TemplateContext {
    const title       = (typeof s.bookTitle === 'string' ? s.bookTitle : undefined) ?? 'Untitled';
    const author      = s.author      ?? '';
    const description = s.description ?? '';
    const genre       = s.genre       ?? '';
    const audience    = s.targetAudience ?? '';
    const storyFolder = s.storyFolder  ?? 'Story';
    const notesFolder = 'Notes';
    const arcFolder   = 'Arc';
    const languages   = s.languages   ?? [];

    const langList = languages.length > 0
        ? languages.map((l, i) => i === 0 ? `${l.code} (source)` : `${l.code} (translation)`).join(', ')
        : 'EN (source)';

    return { title, author, description, genre, audience, storyFolder, notesFolder, arcFolder, languages, langList, hasMultiLang: languages.length > 1 };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writeFile(
    root:      string,
    relPath:   string,
    content:   string,
    overwrite: boolean,
    result:    AiSetupResult
): void {
    const full = path.join(root, relPath);
    if (fs.existsSync(full) && !overwrite) {
        result.skipped.push(relPath);
        return;
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
    result.created.push(relPath);
}

function audienceNote(ctx: TemplateContext): string {
    return ctx.audience ? `Target audience: ${ctx.audience}.` : '';
}

function languageSection(ctx: TemplateContext): string {
    if (!ctx.hasMultiLang) { return ''; }
    return `\nLanguages: ${ctx.langList}.\n`;
}

// ─── CLAUDE.md ────────────────────────────────────────────────────────────────

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
    lines.push(languageSection(ctx));

    lines.push(
        '## Start of session',
        `1. Read COWORK.md (if present) for current focus and context.`,
        `2. Read ${notesFolder}/Memories/global.md for cross-chapter decisions.`,
        `3. If working on a specific chapter, read ${notesFolder}/Memories/chXX.md if it exists.`,
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
        `| \`${notesFolder}/Memories/global.md\` | Cross-session decisions |`,
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

// ─── .github/copilot-instructions.md ─────────────────────────────────────────

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

// ─── .cursor/rules ────────────────────────────────────────────────────────────

function cursorRules(ctx: TemplateContext): string {
    const { title, storyFolder, notesFolder, arcFolder } = ctx;
    const lines: string[] = [
        `# Cursor rules — ${title}`,
        '',
        `Story folder: \`${storyFolder}/\``,
        `Notes folder: \`${notesFolder}/\``,
        `Arc folder: \`${arcFolder}/\` (Overall.md, Act_I_*.md, Act_II_*.md, Act_III_*.md)`,
        '',
        '## Context files to read',
        `- \`${notesFolder}/Memories/global.md\` — cross-chapter decisions (read at start of session)`,
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

// ─── AGENTS.md ────────────────────────────────────────────────────────────────

function agentsMd(ctx: TemplateContext): string {
    const { title, author, description, genre, storyFolder, notesFolder, arcFolder } = ctx;
    const lines: string[] = [`# Agent Instructions — ${title}`, ''];
    lines.push('## Project overview');
    if (genre)       { lines.push(`${genre} novel.`); }
    if (description) { lines.push(description); }
    if (ctx.audience){ lines.push(audienceNote(ctx)); }
    if (author)      { lines.push(`Author: ${author}.`); }
    lines.push(languageSection(ctx), '');

    lines.push(
        '## Start of session',
        `1. Read \`${notesFolder}/Memories/global.md\` for cross-chapter context.`,
        `2. If working on a specific chapter, read \`${notesFolder}/Memories/chXX.md\` if it exists.`,
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
        `| \`${notesFolder}/Memories/global.md\` | Cross-session decisions |`,
    );

    return lines.join('\n') + '\n';
}

// ─── Skill templates ──────────────────────────────────────────────────────────

function skillMd(skill: SkillTemplate, ctx: TemplateContext): string {
    const { title, storyFolder, notesFolder, arcFolder, audience } = ctx;
    const audienceStr = audience ? audience : 'the target audience';

    switch (skill) {
        case 'review': return `# Skill: /review

Review a chapter of "${title}" and give structured feedback.

## Trigger
User says \`/review\`, "review chapter X", "quick review", or "review my changes".

## Clarify first
- Which chapter number?
- Type: **Full** (language + arc + age-appropriateness) or **Quick** (language and typos only)?

## Steps

### 1. Load context
- Read \`${notesFolder}/Memories/global.md\`
- For a Full review, read the relevant arc file: \`${arcFolder}/Act_I_[X].md\`, \`Act_II_[X].md\`, or \`Act_III_[X].md\`
- For "review changes", use the git diff tool if available

### 2. Perform the review

**Quick** — language and typos only.

**Full** — adds:
- Arc consistency with the arc file
- Age-appropriateness for ${audienceStr}
- Character consistency with Notes/Details_Characters.md

### 3. Output format

| Location | Before | Suggested | Reason |
|---|---|---|---|
| Line X | ...original... | ...suggestion... | reason |

- Bold changed words
- Group by category for Full reviews
- End with a 2-3 sentence overall impression

## Rules
- Do not rewrite unless asked — suggest only
- Respond in English always
`;

        case 'brainstorm': return `# Skill: /brainstorm

Brainstorm story ideas, character moments, or plot solutions for "${title}".

## Trigger
User says \`/brainstorm\`, "I'm stuck", "help me think of ideas", or "Am I stuck?".

## Clarify first
- Focus: plot beat / character moment / scene idea / chapter opening-closing?
- Which chapter or story point?
- Any constraints to respect?

## Steps

1. Read \`${notesFolder}/Memories/global.md\` and the relevant arc file from \`${arcFolder}/\`.
2. If character-focused, read \`${notesFolder}/Details_Characters.md\`.
3. Generate 3–5 concrete ideas that fit the arc and feel true to the characters.

## Output format

**Option A — [short title]**
[3-5 sentence description]

...

End with a brief note on which options feel most aligned with the arc.

## Rules
- Respect established world rules and character voices
- Keep ideas appropriate for ${audienceStr}
- Respond in English always
`;

        case 'memory': return `# Skill: /memory

Update project memory files with decisions from the current session.

## Trigger
User says \`/memory\`, "save this to memory", "update memories", or at session end.

## Steps

1. Identify decisions/insights from the session.
2. Write to \`${notesFolder}/Memories/global.md\` (cross-chapter) or \`${notesFolder}/Memories/chXX.md\` (chapter-specific).
3. Append only — never edit existing entries.
4. Format: \`**[YYYY-MM-DD]:** - [decision]\`
5. If a file exceeds ~150 lines, offer to compact the oldest 50% into a summary block.

## Rules
- Append only
- Date every entry
- Compaction is always opt-in
- Respond in English always
`;

        case 'translate': return `# Skill: /translate

Translate a chapter or passage into the target language.

## Trigger
User says \`/translate\`, "translate chapter X", or "help me with the translation".

## Clarify first
- Which chapter or passage?
- Full translation or spot-check an existing translation?

## Steps

1. Read \`${notesFolder}/Details_Translation_notes.md\` for world-specific term translations.
2. Read the source chapter from \`${storyFolder}/\`.
3. Translate paragraph by paragraph, applying all terms from the translation table.
4. Output the translation in a fenced \`\`\`markdown code block for easy pasting.

For spot-check mode, use a feedback table instead of a full translation.

## Rules
- Always consult the translation table first — never invent translations for world-specific terms
- Flag uncertain terms rather than guessing
- Respond in English in explanations
`;

        case 'status': return `# Skill: /status

Snapshot of the book's progress: what's done, in progress, and coming up.

## Trigger
User says \`/status\`, "what's the book status", or "where are we".

## Steps

1. Read COWORK.md (current focus), \`${notesFolder}/Chapter_Status.md\`, and \`${notesFolder}/Memories/global.md\`.
2. Check \`${arcFolder}/\` for what's planned vs written (Overall.md + the relevant act file).
3. Output: overall count / done / in-progress / coming up (next 2-3 chapters) / open questions.

## Output
Keep it scannable — bold headers, short lines. This is a working tool, not a narrative summary.
`;

        case 'continuity': return `# Skill: /continuity

Cross-check a chapter for consistency errors.

## Trigger
User says \`/continuity\`, "check continuity", or "check chapter X for errors".

## Clarify first
- Chapter number?
- Focus: All / Characters / World rules / Timeline?

## Steps

1. Read the chapter, \`${notesFolder}/Memories/global.md\`, and \`${notesFolder}/Details_Characters.md\`.
2. For world rules: read \`${notesFolder}/Details_World_and_Magic.md\`.
3. For timeline: also read the previous chapter.

## Output format

| Type | Location | Issue | Reference |
|---|---|---|---|
| Character | Line X | Description contradicts... | global.md |

End with a one-line overall assessment. If no issues found, say so clearly.

## Rules
- Flag issues only — do not suggest rewrites
- Phrase uncertain items as questions, not errors
- Respond in English always
`;

        case 'read_aloud': return `# Skill: /read-aloud

Test how a chapter sounds when read aloud to ${audienceStr}.

## Trigger
User says \`/read-aloud\`, "reading test", or "how does this sound".

## Clarify first
- Whole chapter or specific passage?

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
- Respond in English always
`;
    }
}
