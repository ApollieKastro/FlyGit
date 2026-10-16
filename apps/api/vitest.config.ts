import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Unit tests only — e2e lives in vitest.e2e.config.ts.
    globals: false,
  },
});
