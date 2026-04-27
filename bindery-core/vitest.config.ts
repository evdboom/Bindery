import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'text-summary', 'lcov', 'html'],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            thresholds: {
                statements: 80,
                branches:   65,
                functions:  90,
                lines:      80,
            },
        },
    },
});
