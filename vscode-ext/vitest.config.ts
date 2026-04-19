import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'text-summary', 'lcov', 'html'],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            exclude: [
                'src/ai-setup-templates.ts', // generated copy of mcp-ts/src/templates.ts
                'src/extension.ts',          // thin VS Code activation layer; exercised via integration-commands mocks
                'src/ai-setup.ts',           // thin wrapper around mcp-ts setupAiFiles; covered by mcp-ts tests
                'src/mcp.ts',                // vscode.lm.registerTool wiring; activation-only, not reachable in unit tests
            ],
            thresholds: {
                statements: 80,
                branches:   65,
                functions:  90,
                lines:      80,
            },
        },
    },
});
