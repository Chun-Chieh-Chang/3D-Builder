// `node scripts/test-durations.mjs <run id or saved log>...`: update scripts/test-durations.json, the file times the nightly
// `full-suite` shards by (scripts/test-shards.ts), from the logs of GitHub Actions runs (`gh run view <id> --log`, or a log saved from it).
//
// A time is what vitest printed for the file in a "Full unit suite" step, in seconds. Of several runs the larger time is kept (runners differ,
// up to 1.72x on the same files, DEV_LOG 2026-11-14). Files of the old table that no run printed are kept as they were, and files that are
// no longer in the repository are dropped. Read-only apart from the table.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TABLE = join(ROOT, 'scripts', 'test-durations.json');
/** vitest.config.ts `include`, as paths from the root */
const SUITE = /^(packages\/[^/]+\/test|apps\/[^/]+\/test|tests)\/.+\.test\.ts$/;
/** run alone, in a job of its own, not sharded */
const ALONE = new Set(['tests/phase6/section-offset-cost.test.ts']);

/** File times, in seconds, of the "Full unit suite" steps in one run's log. */
export function fileTimes(log) {
  const times = {};
  for (const line of log.split('\n')) {
    const [job, step, rest] = line.split('\t');
    if (!job?.startsWith('full-suite') || !step?.startsWith('Full unit suite') || rest === undefined) continue;
    // "<timestamp> ✓ path (n tests[ | k skipped]) 1234ms"; a skipped file has no time
    const text = rest.replace(/\x1b\[[0-9;]*m/g, '').replace(/^\S+ /, '');
    const m = text.match(/^ \S (\S+\.test\.ts) \(\d+ tests?[^)]*\)(?: (\d+)ms)?\s*$/);
    if (m) times[m[1]] = m[2] ? Number(m[2]) / 1000 : 0;
  }
  return times;
}

function main(args) {
  if (args.length === 0) {
    console.error('usage: node scripts/test-durations.mjs <run id or saved log>...');
    process.exit(2);
  }
  const old = existsSync(TABLE) ? JSON.parse(readFileSync(TABLE, 'utf8')) : {};
  const fresh = {};
  for (const arg of args) {
    const log = /^\d+$/.test(arg) ? execFileSync('gh', ['run', 'view', arg, '--log'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 30 }) : readFileSync(arg, 'utf8');
    const times = fileTimes(log);
    const n = Object.keys(times).length;
    if (n === 0) throw new Error(`${arg}: no file times found (not a full-suite run, or the log format changed)`);
    console.log(`${arg}: ${n} files`);
    for (const [file, t] of Object.entries(times)) fresh[file] = Math.max(fresh[file] ?? 0, t);
  }
  const tracked = new Set(execFileSync('git', ['ls-files', '*.test.ts'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => SUITE.test(f) && !ALONE.has(f)));
  const table = {};
  for (const file of [...new Set([...Object.keys(old), ...Object.keys(fresh)])].sort()) {
    if (!tracked.has(file)) continue;
    table[file] = Math.round((fresh[file] ?? old[file]) * 10) / 10;
  }
  const dropped = Object.keys(old).filter((f) => !(f in table));
  const missing = [...tracked].filter((f) => !(f in table));
  writeFileSync(TABLE, `${JSON.stringify(table, null, 2)}\n`);
  console.log(`${Object.keys(table).length} files written; ${dropped.length} dropped (gone)${missing.length ? `; no time yet: ${missing.join(', ')}` : ''}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
