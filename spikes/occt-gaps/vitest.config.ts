import { defineConfig } from 'vitest/config';

// Runs the timing measurements in this folder (they are not part of `npm test`).
export default defineConfig({
  test: { include: ['spikes/**/*.test.ts'], environment: 'node', testTimeout: 300_000, hookTimeout: 120_000 },
});
