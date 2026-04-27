import { audienceNote, languageSection, type TemplateContext, type TemplateMeta } from './context';

export const meta: TemplateMeta = {
    file:    'CLAUDE.md',
    version: 10,
    label:   'project instructions',
    zip:     null,
};

export function render(ctx: TemplateContext): string {
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
