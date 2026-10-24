import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/acceptance/callout-exports.acceptance.ts'], environment: 'node', maxWorkers: 1 } });
