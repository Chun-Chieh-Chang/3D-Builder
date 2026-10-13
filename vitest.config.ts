import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // How many test files run at once. The default (all cores but one: 15 on the i5-14400, 10 real cores) put the heavy OCCT files on shared and slow
    // cores, and a knurl test of 25 s alone ran out of its 60 s (147 to 157 s). Measured on 10-13, the whole suite, interleaved runs:
    //   15: 399 / 415 s, 3 failed (two timeouts and a timing)   8: 360 / 362 s, 1 timeout   6: 317 / 339 s, 0, that test 45 s   4: 334-339 s, 0, that test 29 s.
    // 4 is as fast as any, and leaves that test twice its time. The cure is fewer files fighting for the cores, not a longer timeout (AGENTS.md §3.3).
    maxWorkers: 4,
  },
});
