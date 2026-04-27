"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meta = void 0;
exports.render = render;
const context_1 = require("./context");
exports.meta = {
    file: 'AGENTS.md',
    version: 8,
    label: 'agents instructions',
    zip: null,
};
function render(ctx) {
    const { title, author, description, genre, storyFolder, notesFolder, arcFolder, memoriesFolder } = ctx;
    const lines = [`# Agent Instructions — ${title}`, ''];
    lines.push('## Project overview');
    if (genre) {
        lines.push(`${genre} novel.`);
    }
    if (description) {
        lines.push(description);
    }
    if (ctx.audience) {
        lines.push((0, context_1.audienceNote)(ctx));
    }
    if (author) {
        lines.push(`Author: ${author}.`);
    }
    lines.push((0, context_1.languageSection)(ctx), '', '## Start of session', `1. Read \`${memoriesFolder}/global.md\` for cross-chapter context.`, `2. If working on a specific chapter, read \`${memoriesFolder}/chXX.md\` if it exists.`, '3. Check `.claude/skills/` for shared slash workflows before improvising a bespoke process.', '', '## Story files', `- Chapter files are \`.md\` files in \`${storyFolder}/\`, organized in act subfolders.`, '- HTML comments `<!-- -->` are writer notes — treat as context only, not prose.', '- Quotation marks and em-dashes are managed by the Bindery extension. Do not normalize them.', '', '## Shared skill workflows', '- Shared workflows live in `.claude/skills/` and can be used by agents beyond Claude when the runtime supports workspace skills.', '- Prefer `/read-in`, `/review`, `/translation-review`, `/translate`, `/memory`, `/continuity`, `/status`, `/read-aloud`, and `/proof-read` when the user is asking for one of those structured tasks.', '', '## Writing guidelines', '- Do not rewrite paragraphs unless explicitly asked. Suggest edits only.');
    if (ctx.audience) {
        lines.push(`- Audience is ${ctx.audience}. Keep vocabulary clear and themes age-appropriate.`);
    }
    lines.push('', '## Key reference files', '| File | Contains |', '|---|---|', `| \`${arcFolder}/\` | Story arc files for overall and per-act structure and beats |`, `| \`${notesFolder}/\` | Story notes, like character profiles and world rules |`, `| \`${memoriesFolder}/global.md\` | Cross-session decisions |`);
    return lines.join('\n') + '\n';
}
//# sourceMappingURL=agents.js.map