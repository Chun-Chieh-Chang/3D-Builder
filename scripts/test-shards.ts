/**
 * Splitting the test files over CI shards by measured time (nightly `full-suite`).
 *
 * vitest's own `--shard` cuts the files sorted by a hash of the path: the counts are equal, the times are not. With
 * the file times of run 43561427221 the eight shards held 381 to 1501 s of file time, and the slowest took 886 s of
 * 2-worker wall time. Here the longest file goes first, each to the shard with the least time so far
 * (longest-processing-time first), so every shard gets about the same time.
 *
 * Every runner computes the split on its own, so it must depend on nothing but the file list and the times: ties
 * go by path, and the order the files arrive in does not matter. A file with no measured time (a new one) counts as
 * `fallback` seconds and is named, so that the times are updated (`node scripts/test-durations.mjs <run id>`).
 */
export interface ShardPlan {
  /** the files of each shard, longest first: shard i (1-based) is `shards[i - 1]` */
  shards: string[][];
  /** seconds of file time in each shard, by the measured times (and `fallback` for files without one) */
  seconds: number[];
  /** files that had no measured time */
  unknown: string[];
}

export function planShards(files: readonly string[], measured: Readonly<Record<string, number>>, count: number, fallback: number): ShardPlan {
  if (!Number.isInteger(count) || count < 1) throw new Error(`shard count must be a positive integer, got ${count}`);
  if (!Number.isFinite(fallback) || fallback < 0) throw new Error(`fallback time must be a finite number >= 0, got ${fallback}`);
  const unique = [...new Set(files)];
  if (unique.length !== files.length) throw new Error('the file list has duplicates');
  const unknown: string[] = [];
  const time = new Map<string, number>();
  for (const file of unique) {
    const t = measured[file];
    if (t === undefined) unknown.push(file);
    else if (!Number.isFinite(t) || t < 0) throw new Error(`measured time of ${file} must be a finite number >= 0, got ${t}`);
    time.set(file, t ?? fallback);
  }
  const order = unique.sort((a, b) => time.get(b)! - time.get(a)! || (a < b ? -1 : a > b ? 1 : 0));
  const shards: string[][] = Array.from({ length: count }, () => []);
  const seconds: number[] = Array.from({ length: count }, () => 0);
  for (const file of order) {
    // the shard with the least time; of equal ones, the lowest number
    let k = 0;
    for (let i = 1; i < count; i++) if (seconds[i]! < seconds[k]!) k = i;
    shards[k]!.push(file);
    seconds[k]! += time.get(file)!;
  }
  return { shards, seconds, unknown: unknown.sort() };
}

/**
 * What a file without a measured time is taken to cost: the mean of the measured times (0 when there are none). The
 * mean, not the median: most files take well under a second, and a new file is as likely to be a heavy fuzz file.
 */
export function meanTime(measured: Readonly<Record<string, number>>): number {
  const values = Object.values(measured);
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}
