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
                'src/templates.ts',      // large code-as-data aggregator; covered by mcp-ts tests
                'src/templates/**',      // individual template modules; covered by mcp-ts tests
                'src/index.ts',          // barrel re-export only
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
