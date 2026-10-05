import { defineConfig } from 'vitest/config';

// Only the kit generator (`npm run make:kit`); it is not part of `npm test`, which would write files outside the checkout.
export default defineConfig({
  test: {
    include: ['tests/kit/**/*.kit.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
