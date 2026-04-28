/**
 * Formatter — applies typography to a single Obsidian vault file.
 *
 * Uses `applyTypography` from @bindery/core. The vault read/modify calls
 * are injected as parameters so this module is fully testable.
 */

import { applyTypography } from '@bindery/core';
import type { TFile, Vault } from './obsidian-types';

/**
 * Apply typography formatting to a markdown file in the vault.
 * Only writes the file if the content actually changed.
 *
 * @param vault  - Obsidian Vault instance (or test mock)
 * @param file   - TFile to format
 * @returns true if the file was modified, false if already well-formatted
 */
export async function formatFile(vault: Vault, file: TFile): Promise<boolean> {
    const original = await vault.read(file);
    const formatted = applyTypography(original);
    if (formatted === original) {
        return false;
    }
    await vault.modify(file, formatted);
    return true;
}

/**
 * Apply typography formatting to raw text content.
 * Convenience wrapper — avoids importing applyTypography in callers.
 */
export function formatText(content: string): string {
    return applyTypography(content);
}
