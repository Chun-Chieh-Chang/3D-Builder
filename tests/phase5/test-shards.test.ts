/**
 * The nightly `full-suite` shards by measured file time (scripts/test-shards.ts, vitest.config.ts `DurationSequencer`). Every runner computes the
 * split on its own, so what is checked is that each file lands in exactly one shard whatever the order it arrives in, that the shards come out even,
 * and that a file without a measured time is still run and named. vitest's path-hash split of the same times held 381 to 1501 s a shard
 * (run 43561427221, 2026-11-14).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { meanTime, planShards } from '../../scripts/test-shards.ts';
// @ts-expect-error: a plain .mjs script with no type declarations
import { fileTimes } from '../../scripts/test-durations.mjs';

/** a small fixed-seed generator, so a failure can be repeated */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function shuffle<T>(items: readonly T[], next: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

describe('splitting test files over shards by measured time', () => {
  it('200 random suites: every file in exactly one shard, the same split whatever the input order, and no shard more than the longest file above another', () => {
    const next = rng(20261114);
    for (let n = 0; n < 200; n++) {
      const count = 1 + Math.floor(next() * 10);
      const files = Array.from({ length: Math.floor(next() * 120) }, (_, i) => `t/f${i}.test.ts`);
      // most files short, a few long, some exactly equal (ties go by path)
      const measured = Object.fromEntries(files.map((f) => [f, next() < 0.1 ? 50 + next() * 400 : next() < 0.2 ? 1 : next() * 5]));
      const plan = planShards(files, measured, count, 0);
      expect(plan.shards).toHaveLength(count);
      expect(plan.shards.flat().sort()).toEqual([...files].sort());
      expect(plan.unknown).toEqual([]);
      expect(planShards(shuffle(files, next), measured, count, 0)).toEqual(plan);
      const longest = Math.max(0, ...Object.values(measured));
      expect(Math.max(...plan.seconds) - Math.min(...plan.seconds)).toBeLessThanOrEqual(longest + 1e-9);
      plan.shards.forEach((s, i) => expect(s.reduce((t, f) => t + measured[f]!, 0)).toBeCloseTo(plan.seconds[i]!, 9));
    }
  });

  it('the times measured in CI: the eight shards within 2 % of an even split (vitest by hash: 381 to 1501 s)', () => {
    const measured: Record<string, number> = JSON.parse(readFileSync(new URL('../../scripts/test-durations.json', import.meta.url), 'utf8'));
    const files = Object.keys(measured);
    expect(files.length).toBeGreaterThan(400);
    const total = Object.values(measured).reduce((s, t) => s + t, 0);
    expect(total).toBeGreaterThan(0);
    const plan = planShards(files, measured, 8, meanTime(measured));
    expect(Math.max(...plan.seconds)).toBeLessThanOrEqual((total / 8) * 1.02);
    expect(Math.min(...plan.seconds)).toBeGreaterThanOrEqual((total / 8) * 0.98);
  });

  it('a file with no measured time is run, counted as the fallback, and named', () => {
    const plan = planShards(['a.test.ts', 'new.test.ts', 'b.test.ts'], { 'a.test.ts': 10, 'b.test.ts': 10 }, 2, 7);
    expect(plan.unknown).toEqual(['new.test.ts']);
    expect(plan.shards.flat().sort()).toEqual(['a.test.ts', 'b.test.ts', 'new.test.ts']);
    expect([...plan.seconds].sort((x, y) => x - y)).toEqual([10, 17]);
    expect(meanTime({ a: 1, b: 2, c: 9 })).toBe(4);
    expect(meanTime({})).toBe(0);
  });

  it('more shards than files: the extra shards are empty, not an error', () => {
    const plan = planShards(['a.test.ts'], { 'a.test.ts': 3 }, 4, 0);
    expect(plan.shards).toEqual([['a.test.ts'], [], [], []]);
  });

  it('refuses a shard count that is not a positive integer, a bad time, a bad fallback and a repeated file', () => {
    for (const count of [0, -1, 1.5, Number.NaN, Infinity]) expect(() => planShards(['a'], { a: 1 }, count, 0)).toThrow(/shard count/);
    for (const t of [-1, Number.NaN, Infinity]) expect(() => planShards(['a'], { a: t }, 2, 0)).toThrow(/measured time of a/);
    for (const fallback of [-1, Number.NaN]) expect(() => planShards(['a'], {}, 2, fallback)).toThrow(/fallback/);
    expect(() => planShards(['a', 'a'], { a: 1 }, 2, 0)).toThrow(/duplicates/);
  });
});

describe('reading file times from a GitHub Actions log', () => {
  it('takes the file lines of the "Full unit suite" step only, with ANSI colour, skipped files at 0, and ignores test lines and other steps', () => {
    const T = '2026-11-14T05:30:00.0000000Z';
    const log = [
      `full-suite (3)\tFull unit suite (nightly, shard 3)\t${T}  \x1b[32m✓\x1b[39m tests/phase6/a.test.ts \x1b[2m(6 tests)\x1b[22m\x1b[33m 52590ms\x1b[39m`,
      `full-suite (3)\tFull unit suite (nightly, shard 3)\t${T}    ✓ a test inside it 35342ms`,
      `full-suite (3)\tFull unit suite (nightly, shard 3)\t${T}  ✓ packages/x/test/b.test.ts (3 tests | 1 skipped) 7ms`,
      `full-suite (4)\tFull unit suite (nightly, shard 4)\t${T}  ↓ tests/real.test.ts (2 tests | 2 skipped)`,
      `full-suite (1)\tSection offset cost, alone\t${T}  ✓ tests/phase6/section-offset-cost.test.ts (7 tests) 160000ms`,
      `integrity (ubuntu-latest)\tRun npm test\t${T}  ✓ tests/c.test.ts (1 test) 5ms`,
    ].join('\n');
    expect(fileTimes(log)).toEqual({ 'tests/phase6/a.test.ts': 52.59, 'packages/x/test/b.test.ts': 0.007, 'tests/real.test.ts': 0 });
  });
});
