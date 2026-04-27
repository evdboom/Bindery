"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meta = void 0;
exports.render = render;
const context_1 = require("./context");
exports.meta = {
    file: '.github/copilot-instructions.md',
    version: 8,
    label: 'copilot instructions',
    zip: null,
};
function render(ctx) {
    const { title, author, description, genre, storyFolder, notesFolder, arcFolder } = ctx;
    const lines = [`# GitHub Copilot — ${title}`, ''];
    if (genre || description || ctx.audience) {
        lines.push('## Project');
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
        lines.push((0, context_1.languageSection)(ctx), '');
    }
    lines.push('## Repo layout', '```', `${arcFolder}/  ← story arc files`, `${notesFolder}/  ← story bible, translation table, memories`, `${storyFolder}/`, ...ctx.languages.map(l => `  ${l.folderName}/  ← ${l.code} chapters`), '```', '', '## Shared skill workflows', '- Workspace skill files live in `.claude/skills/` and may also be picked up by agents beyond Claude.', '- Prefer those shared slash workflows when available: `/read-in`, `/review`, `/translation-review`, `/translate`, `/memory`, `/continuity`, `/status`, `/read-aloud`, `/proof-read`.', '', '## Writing guidelines', '- HTML comments `<!-- -->` in chapter files are writer notes — treat as context only.', '- Quotation marks and dashes are managed by the Bindery VS Code extension. Do not normalize them.');
    if (ctx.audience) {
        lines.push(`- Content targets ${ctx.audience}. Keep vocabulary accessible and themes appropriate.`);
    }
    return lines.join('\n') + '\n';
}
//# sourceMappingURL=copilot.js.map