import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/test/**/*.test.ts', 'host/test/**/*.test.ts', 'client/test/**/*.test.ts'],
    exclude: ['**/*.balance.test.ts', '**/node_modules/**'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
