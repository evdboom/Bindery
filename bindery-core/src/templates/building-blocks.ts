import { type TemplateContext, type AgentTemplate } from './context';

/**
 * Shared project-intent section used by top-level AI instruction templates.
 */
export function pushProjectSection(lines: string[], ctx: TemplateContext): void {
    lines.push('## Project');
    if (ctx.genre) {lines.push(`Genre: ${ctx.genre}`); }
    if (ctx.description) { lines.push(ctx.description); }
    if (ctx.audience) { lines.push(`Target audience: ${ctx.audience}.`); }
    if (ctx.author) { lines.push(`Author: ${ctx.author}.`); }
    if (ctx.hasMultiLang) { lines.push(`Languages: ${ctx.langList}`); }
}

/**
 * Canonical capabilities pointer shared by all top-level AI instruction files.
 */
export function pushCapabilitiesSource(lines: string[]): void {
    lines.push(
        '## Capabilities source',
        '- Use `.bindery/README.md` if you require the canonical source for Bindery capabilities and workflows.',
    );
}

/**
 * Shared session-start instructions used by top-level AI instruction templates.
 */
export function pushSessionStart(lines: string[], ctx: TemplateContext, agent: AgentTemplate): void {
    lines.push(
        '## Start of session',
        '1. Run `bindery_health` from the Bindery MCP and check `ai_versions_outdated`.',
        '2. If `ai_versions_outdated` has entries, run `bindery_setup_ai_files`.' + (agent.requiresSkillUpload ? ' If `skill_files.reupload_required` has entries, ask the user to re-upload those SKILL.md files to use them.' : ''),
    );
    if (agent.hasSkills) {
    lines.push(
        '3. Use /read-in at the start of a session to load context and get your bearings.',
        `4. If the skill is not available, read at least ${ctx.sessionFile} (if present, use \`bindery_session_focus_get\`) for current focus and handoff context, and ${ctx.preferencesFile} for the author's durable working preferences.`,
    );
    } else { 
    lines.push(
        `3. Read ${ctx.sessionFile} (if present) for current focus and handoff context, and ${ctx.preferencesFile} for the author's durable working preferences.`,
        `4. If ${ctx.sessionFile} mentions a chapter, \`bindery_get_chapter(chapterNumber)\` to read that chapter and \`bindery_memory_list\` to check for any chapter-specific memory files.`,
    );
    }
}

/**
 * Shared memory-system instructions used by top-level AI instruction templates.
 */
export function pushMemorySystem(lines: string[], agent: AgentTemplate): void {
    lines.push('## Memory system');

    if (agent.hasSkills) {
        lines.push(
            `1. When concluding a discussion, or after you give a meaningful, preservation-worthy response: use /memory to store it.`,
            `2. Also when the user asks or otherwise indicates the end of a session: use /memory to save decisions.`,
        );
    } else {
        lines.push(
            `1. When concluding a discussion, or after you give a meaningful, preservation-worthy response: use \`bindery_memory_append\` to store it.`,
            `2. Also when the user asks or otherwise indicates the end of a session: use \`bindery_memory_append\` to save decisions.`,
            `3. If a memory file grows too large, use \`bindery_memory_compact\` to condense it.`,
        );
    }  
}

export function pushRepoLayout(lines: string[], ctx: TemplateContext): void {
    lines.push(
        '## Repository layout',              
        '```',
        `${ctx.arcFolder}/  ← story architecture (${ctx.arcGranularity}-level arc planning by default)`,
        '  index.md  ← arc map',
        '  Overall.md  ← whole-book arc',
        '  Acts/  ← act-level arc files',
        `${ctx.notesFolder}/  ← story notes`,
        `${ctx.charactersFolder}/  ← character index and one profile per character`,
        `${ctx.sessionFile}  ← ephemeral working state (current focus / next actions / open questions / handoff) via bindery_session_focus_*`,
        `${ctx.preferencesFile}  ← durable working preferences ("do it like this for me"); user-owned, never tool-written`,
        `${ctx.storyFolder}/`,
        ...ctx.languages.map(l => `  ${l.folderName}/  ← ${l.code} chapters (one .md per chapter)`),
        '```',
    );
}

export function pushWritingRules(lines: string[], ctx: TemplateContext): void {
    lines.push(
        '## Writing rules',        
        `- If these rules conflict with the author's preferences in ${ctx.preferencesFile}, follow the preferences.`,
        '- Prefer usage of the Bindery MCP tools over direct file access.',
        '- Never rewrite paragraphs unless explicitly asked. Suggest edits only.',
        '- HTML comments `<!-- -->` in chapter files are writer notes. Treat as context, not prose.',
        '- Quotation marks and dashes in chapter files are managed by the Bindery extension. Do not flag these as formatting errors.',
        '- Inline images use standard markdown image syntax `![alt](relative/path.png)`, resolved relative to the chapter file — this is what renders in host previews and survives export. Do not use Obsidian embed syntax `![[image.png]]`; it only renders inside Obsidian and is stripped (with a warning) at merge time.',
    );
    if (ctx.audience) {
        lines.push(`- Content is aimed at ${ctx.audience}. Keep language accessible and themes age-appropriate.`);
    }
}