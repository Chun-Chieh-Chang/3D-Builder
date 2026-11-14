import { readFileSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';
import { relative } from 'node:path';
import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { meanTime, planShards } from './scripts/test-shards.ts';

const cores = typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;

/**
 * `--shard=i/n` by measured file time instead of vitest's path hash (scripts/test-shards.ts; the times are
 * scripts/test-durations.json, updated with scripts/test-durations.mjs), and the longest files first within a shard.
 * Without `--shard` nothing changes: vitest's own order (failed first, then longest, from its cache).
 */
class DurationSequencer extends BaseSequencer {
  #key = (spec: TestSpecification) => relative(this.ctx.config.root, spec.moduleId).split('\\').join('/');
  #measured = (): Record<string, number> => JSON.parse(readFileSync(new URL('./scripts/test-durations.json', import.meta.url), 'utf8'));

  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard!;
    const measured = this.#measured();
    const byKey = new Map(files.map((f) => [this.#key(f), f]));
    const plan = planShards([...byKey.keys()], measured, count, meanTime(measured));
    const mine = plan.shards[index - 1]!;
    console.log(
      `shard ${index}/${count} by measured time: ${mine.length} of ${byKey.size} files, ${Math.round(plan.seconds[index - 1]!)} s ` +
        `(shards ${plan.seconds.map((s) => Math.round(s)).join(' / ')} s)` +
        (plan.unknown.length ? `; no measured time, taken as ${meanTime(measured).toFixed(1)} s: ${plan.unknown.join(', ')}` : ''),
    );
    return mine.map((k) => byKey.get(k)!);
  }

  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    if (!this.ctx.config.shard) return super.sort(files);
    const measured = this.#measured();
    const fallback = meanTime(measured);
    const time = (f: TestSpecification) => measured[this.#key(f)] ?? fallback;
    return [...files].sort((a, b) => time(b) - time(a) || (this.#key(a) < this.#key(b) ? -1 : 1));
  }
}

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // How many test files run at once. The default (all cores but one: 15 on the i5-14400, 10 real cores) put the heavy OCCT files on shared and slow
    // cores, and a knurl test of 25 s alone ran out of its 60 s (147 to 157 s). Measured on 10-13, the whole suite, interleaved runs:
    //   15: 399 / 415 s, 3 failed (two timeouts and a timing)   8: 360 / 362 s, 1 timeout   6: 317 / 339 s, 0, that test 45 s   4: 334-339 s, 0, that test 29 s.
    // 4 is as fast as any, and leaves that test twice its time. On constrained runners (e.g. GitHub Actions 2-core VMs), cap at available cores
    // to prevent CPU starvation on heavy WASM files (AGENTS.md §3.3).
    maxWorkers: Math.min(4, Math.max(1, cores)),
    sequence: { sequencer: DurationSequencer },
  },
});
