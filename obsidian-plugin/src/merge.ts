/**
 * Obsidian-specific book merge wrapper.
 *
 * Adapts @bindery/merge functions to work with Obsidian's Vault API.
 * Handles file discovery and merging from an Obsidian vault, producing merged markdown
 * suitable for export via Pandoc + LibreOffice.
 */

import {
    mergeBook as mergeBookCore,
    type MergeOptions as MergeOptionsCore,
    type MergeResult,
    type OutputType,
} from '@bindery/merge';
import type { App, Vault } from 'obsidian';
import type { BinderySettings } from './settings-tab';

/**
 * Merge chapters from an Obsidian vault into a single document.
 *
 * @param app - Obsidian App instance for progress notifications
 * @param vault - Obsidian Vault instance for file I/O
 * @param vaultBasePath - Absolute path to the vault root
 * @param bookRoot - Absolute path to the book root folder
 * @param settings - Bindery plugin settings
 * @param outputTypes - Export formats to generate ('md', 'docx', 'epub', 'pdf')
 * @returns Merged book result with output paths and file count
 */
export async function mergeBook(
    app: App,
    vault: Vault,
    vaultBasePath: string,
    bookRoot: string,
    settings: BinderySettings,
    outputTypes: OutputType[]
): Promise<MergeResult> {
    try {
        const options: MergeOptionsCore = {
            root: bookRoot,
            storyFolder: 'Story',  // Obsidian uses same folder structure as VS Code
            language: {
                code: 'EN',
                folderName: 'EN',
                chapterWord: 'Chapter',
                actPrefix: 'Act',
                prologueLabel: 'Prologue',
                epilogueLabel: 'Epilogue',
                isDefault: true,
            },
            outputTypes,
            includeToc: true,
            includeSeparators: true,
            author: undefined,
            bookTitle: undefined,
            outputDir: 'Merged',
            filePrefix: 'Book',
            pandocPath: settings.pandocPath,
            libreOfficePath: settings.libreOfficePath,
        };

        // Call the core merge function
        const result = await mergeBookCore(options);
        return result;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to merge book: ${message}`);
    }
}
