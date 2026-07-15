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
    charactersFolder: string;
    sessionFile:    string;
    preferencesFile: string;
    arcGranularity: string;
    memoriesFolder: string;
    languages:      Array<{ code: string; folderName: string }>;
    langList:       string;
    hasMultiLang:   boolean;
}

/** Per-template metadata used by AI file version reporting. */
export interface TemplateMeta {
    /** Output path relative to the workspace root. Used as the FILE_VERSION_INFO key. */
    file:    string;
    /** Bump when content changes significantly so users are prompted to refresh. */
    version: number;
    /** Short, human-readable label used by health reporting. */
    label:   string;
}

export interface AgentTemplate {
    hasSkills: boolean;
    requiresSkillUpload: boolean;
    name: string;
}