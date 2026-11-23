import { defineConfig } from 'vitest/config';

export default defineConfig({ test: {
  include: ['tests/acceptance/dwg-export.acceptance.ts'],
  environment: 'node', testTimeout: 60_000, hookTimeout: 60_000, maxWorkers: 1,
} });
