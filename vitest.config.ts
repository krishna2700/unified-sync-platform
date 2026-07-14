import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    testTimeout: 15_000,
    env: { LOG_LEVEL: 'silent' },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      // Process entry points (never unit-tested, only smoke-tested live) and pure-interface
      // config files (zero executable statements, nothing to cover) are excluded; see the
      // "Testing strategy & coverage" section of README.md for the full rationale.
      exclude: [
        'src/**/*.d.ts',
        'src/api/server.ts',
        'src/workers/**',
        'src/integrations/*/*-config.ts',
        'src/infrastructure/queue/sync-queue.ts',
      ],
      thresholds: {
        lines: 60,
        statements: 60,
        functions: 60,
        branches: 70,
      },
    },
  },
});
