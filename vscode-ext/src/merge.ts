/**
 * Book merging — re-exported from @bindery/merge
 *
 * This module provides chapter discovery, merging, and export to Markdown,
 * DOCX, EPUB, and PDF via Pandoc + LibreOffice.
 *
 * All implementation logic has been moved to the shared @bindery/merge package
 * for code reuse across VS Code extension, Obsidian plugin, and MCP server.
 */

export {
    type OutputType,
    type MergeOptions,
    type MergeResult,
    mergeBook,
    checkPandoc,
    getPandocOutputFormats,
    clearPandocCapabilityCache,
    getBuiltInUkReplacements,
    type LegacyImageProposal,
    proposeLegacyImageMigration,
    applyLegacyImageMigration,
    type LegacyCoverProposal,
    proposeLegacyCoverMigration,
    applyLegacyCoverMigration,
} from '@bindery/merge';

// Re-export types from bindery-core for backward compatibility
export type { LanguageConfig, DialectConfig, UkReplacement } from '@bindery/core';
