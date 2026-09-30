import { defineConfig } from 'vitest/config';

// Dev-only: runs the headless bot harness for many seeds and prints win rates.
export default defineConfig({
  test: {
    include: ['host/test/**/*.balance.test.ts'],
    environment: 'node',
    testTimeout: 600_000,
  },
});
