/**
 * @bindery/merge — shared merge/export library
 *
 * Pure functions for book chapter discovery, merging, and export to
 * markdown, DOCX, EPUB, and PDF via Pandoc + LibreOffice.
 *
 * Used by VS Code extension and Obsidian plugin.
 */

export {
    type OutputType,
    type MergeOptions,
    type MergeResult,
    type CoverResolution,
    mergeBook,
    checkPandoc,
    getPandocOutputFormats,
    clearPandocCapabilityCache,
    getBuiltInUkReplacements,
    resolveCoverImage,
} from './merge.js';

export {
    type ToolName,
    locateTool,
    locateToolPath,
    clearLocateCache,
} from './tool-locate.js';

export {
    type ImageRewriteResult,
    type PortableCopyResult,
    rewriteImageLinks,
    makePortableMarkdown,
    hasImageLink,
} from './images.js';

export {
    type LegacyImageProposal,
    type LegacyCoverProposal,
    proposeLegacyImageMigration,
    applyLegacyImageMigration,
    proposeLegacyCoverMigration,
    applyLegacyCoverMigration,
} from './legacy-images.js';
