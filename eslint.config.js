import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import obsidianmd from 'eslint-plugin-obsidianmd';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Scope the full obsidianmd recommended config to the Obsidian plugin only.
// We collect rules and plugins from TS-targeting entries but strip languageOptions
// so our main block's parserOptions.project (with all workspace tsconfigs) stays in effect.
const targetsTs = (files) => {
  if (!files) return true;
  const flat = files.flat();
  return flat.some((f) => typeof f === 'string' && (f.includes('.ts') || f.endsWith('.ts')));
};
const obsidianMergedRules = Object.assign(
  {},
  ...obsidianmd.configs.recommended
    .filter((entry) => targetsTs(entry.files))
    .map((entry) => entry.rules ?? {}),
);
const obsidianMergedPlugins = Object.assign(
  {},
  ...obsidianmd.configs.recommended
    .filter((entry) => targetsTs(entry.files))
    .map((entry) => entry.plugins ?? {}),
);

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/.vscode/**', '**/coverage/**'],
  },
  {
    files: ['bindery-core/src/**/*.ts', 'bindery-merge/src/**/*.ts', 'mcp-ts/src/**/*.ts', 'vscode-ext/src/**/*.ts', 'obsidian-plugin/src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: [
          `${__dirname}/bindery-core/tsconfig.json`,
          `${__dirname}/bindery-merge/tsconfig.json`,
          `${__dirname}/mcp-ts/tsconfig.eslint.json`,
          `${__dirname}/vscode-ext/tsconfig.eslint.json`,
          `${__dirname}/obsidian-plugin/tsconfig.eslint.json`,
        ],
        tsconfigRootDir: __dirname,
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        globalThis: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        require: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { 
        args: 'all',
        argsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-require-imports': 'error',
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  // Obsidian plugin: full recommended rules + generic quality rules
  {
    files: ['obsidian-plugin/src/**/*.ts'],
    plugins: obsidianMergedPlugins,
    rules: {
      ...obsidianMergedRules,
      // TypeScript handles undefined identifiers; no-undef causes false positives on imported types
      'no-undef': 'off',
      'no-alert': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/unbound-method': 'error',
    },
  },
  // Other packages: generic rules only (no Obsidian-specific rules)
  {
    files: [
      'mcp-ts/src/**/*.ts',
      'vscode-ext/src/**/*.ts',
      'bindery-core/src/**/*.ts',
      'bindery-merge/src/**/*.ts',
    ],
    rules: {
      'no-alert': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/unbound-method': 'error',
    },
  },
  {
    files: ['**/test/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        globalThis: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        HTMLElement: 'readonly',
        RequestInit: 'readonly',
        require: 'readonly',
        vi: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        beforeAll: 'readonly',
        afterEach: 'readonly',
        afterAll: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
];


