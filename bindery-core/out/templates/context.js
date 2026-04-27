"use strict";
/**
 * Shared types + tiny helpers for every template module.
 *
 * Each template file under `templates/` exports `{ meta, render }` and
 * imports `TemplateContext` (and helpers when needed) from this module.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.audienceNote = audienceNote;
exports.languageSection = languageSection;
function audienceNote(ctx) {
    return ctx.audience ? `Target audience: ${ctx.audience}.` : '';
}
function languageSection(ctx) {
    if (!ctx.hasMultiLang) {
        return '';
    }
    return `\nLanguages: ${ctx.langList}.\n`;
}
//# sourceMappingURL=context.js.map