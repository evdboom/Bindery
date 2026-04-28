/**
 * Shared types + tiny helpers for every template module.
 *
 * Each template file under `templates/` exports `{ meta, render }` and
 * imports `TemplateContext` (and helpers when needed) from this module.
 */

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

/** Per-template metadata. `zip` is non-null only for skills (which ship as zips). */
export interface TemplateMeta {
    /** Output path relative to the workspace root. Used as the FILE_VERSION_INFO key. */
    file:    string;
    /** Bump when content changes significantly so users are prompted to refresh. */
    version: number;
    /** Short, human-readable label used by health reporting. */
    label:   string;
    /** Companion zip path (skills only) or null. */
    zip:     string | null;
}

export function audienceNote(ctx: TemplateContext): string {
    return ctx.audience ? `Target audience: ${ctx.audience}.` : '';
}

export function languageSection(ctx: TemplateContext): string {
    if (!ctx.hasMultiLang) { return ''; }
    return `\nLanguages: ${ctx.langList}.\n`;
}
