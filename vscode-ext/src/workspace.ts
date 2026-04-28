/**
 * Bindery — workspace settings reader — re-export shim.
 *
 * The settings types and helpers have moved to `@bindery/core`.
 * This file re-exports everything to preserve backward compatibility
 * for existing imports within vscode-ext and tests.
 */

export * from '@bindery/core';
