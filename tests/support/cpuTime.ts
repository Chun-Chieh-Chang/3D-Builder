/**
 * How long one call of `fn` keeps the CPU busy, in ms: what this process spent on it, not the wall clock. With the whole suite at once the other test
 * files (each a process of its own) take the CPU too, and the wall clock of a few-millisecond call was seen 5 times over its budget; the CPU this
 * process used hardly moves (rebuild-speed.test.ts measures the same way). Called once first, so the JIT has compiled it, then `runs` times measured
 * together: on Windows process.cpuUsage counts in clock ticks of about 15.6 ms, so a call of a few ms only shows in a sum.
 */
export function cpuMsPerCall(fn: () => unknown, runs = 20): number {
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`runs must be a whole number of at least 1, not ${runs}`);
  fn();
  const t0 = process.cpuUsage();
  for (let i = 0; i < runs; i++) fn();
  const used = process.cpuUsage(t0);
  return (used.user + used.system) / 1000 / runs;
}
