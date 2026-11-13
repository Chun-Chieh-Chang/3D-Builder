// Mutation controls for C2.8–C2.10 and ADR 0248: each breaks one claim, runs the test that should catch it, restores the file and checks the restore.
// The old text must occur exactly once, or the mutation is not counted. A backup is written first (an interrupted run leaves it: restore by hand).
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const RR = 'packages/kernel/src/roundRecognition.ts', SD = 'packages/kernel/src/surfaceDeviation.ts';
const muts = [
  { name: 'C2.8 sharp points not put on both surfaces', file: RR, from: '    const exact = onBoth(oc, a, b, points);', to: '    const exact = points;', test: 'tests/phase8/recognize-rolling-ball.test.ts' },
  { name: 'C2.10 distance to the edge curve, not to its faces', file: RR, from: '      if (on.length === 0) return q.d;', to: '      return q.d;', test: 'tests/phase8/recognize-rolling-ball.test.ts' },
  { name: 'inside-face test back to SetCoord(u, v)', file: RR, from: '      p.SetX(u);\n      p.SetY(v);', to: '      p.SetCoord(u, v);', test: 'tests/phase8/recognize-rolling-ball.test.ts' },
  { name: 'deviation: no classifier (untrimmed surface)', file: SD, from: '    if (s === IN || s === ON || String(s) === String(IN) || String(s) === String(ON)) return', to: '    if (true) return', test: 'packages/kernel/test/surface-deviation.test.ts' },
  { name: 'deviation: weights 1, not the area element', file: SD, from: '          const w = len(cross(s.du as V3, s.dv as V3)) * uvArea;', to: '          const w = 1;', test: 'packages/kernel/test/surface-deviation.test.ts' },
  { name: 'deviation: nearest triangle only (no slack)', file: SD, from: '    const slack = 2 * tolerance + 1e-9;', to: '    const slack = 0;', test: 'packages/kernel/test/surface-deviation.test.ts' },
];
const only = process.argv[2] ? new Set(process.argv[2].split(',').map(Number)) : null;
const results = [];
// the base must be green first, or every mutation reads red (AGENTS §4 2026-11-07 #3)
for (const t of [...new Set(muts.map((m) => m.test))]) {
  const r = spawnSync('npx.cmd', ['vitest', 'run', t], { encoding: 'utf8', shell: true, maxBuffer: 1 << 26 });
  console.log(`BASE ${t}: ${r.status === 0 ? 'green' : 'RED'}`);
  if (r.status !== 0) process.exit(1);
}
muts.forEach((m, i) => {
  if (only && !only.has(i)) return;
  const src = readFileSync(m.file, 'utf8');
  const n = src.split(m.from).length - 1;
  if (n !== 1) { results.push(`${i} ${m.name}: NOT APPLIED (${n} matches)`); return; }
  copyFileSync(m.file, m.file + '.bak');
  try {
    writeFileSync(m.file, src.replace(m.from, m.to));
    const r = spawnSync('npx.cmd', ['vitest', 'run', m.test], { encoding: 'utf8', shell: true, maxBuffer: 1 << 26 });
    const failed = (r.stdout + r.stderr).split(/\r?\n/).filter((l) => /^\s+×/.test(l)).map((l) => l.trim().slice(0, 90));
    results.push(`${i} ${m.name}: ${r.status === 0 ? 'GREEN (not caught)' : 'red'}${failed.length ? ' — ' + failed.join(' | ') : ''}`);
  } finally {
    writeFileSync(m.file, src);
    if (readFileSync(m.file, 'utf8') !== readFileSync(m.file + '.bak', 'utf8')) throw new Error('restore failed: ' + m.file);
    unlinkSync(m.file + '.bak');
  }
});
console.log(results.join('\n'));
