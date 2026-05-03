/**
 * Tool path location — re-exported from @bindery/merge
 *
 * Auto-detects Pandoc and LibreOffice installations across platforms (Windows, macOS, Linux).
 * All implementation logic has been moved to @bindery/merge for code reuse.
 */

export {
    type ToolName,
    locateTool,
    locateToolPath,
    clearLocateCache,
} from '@bindery/merge';
