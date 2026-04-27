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
                'src/main.ts',          // Obsidian Plugin lifecycle, not unit-testable
                'src/settings-tab.ts',  // Obsidian UI component, not unit-testable
            ],
            thresholds: {
                statements: 80,
                branches:   60,
                functions:  80,
                lines:      80,
            },
        },
    },
});
