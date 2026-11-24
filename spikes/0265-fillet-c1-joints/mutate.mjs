// Mutation check: each mutation undoes one part of the change; the named test file must then fail. Each pattern must occur exactly once; the file is
// restored from a backup in memory after each run (and checked byte-equal).
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const M = [
  ['packages/kernel/src/kernel.ts', "lastErr = new KernelError(t('feature.filletTolerance', { tolerance: tolerance.toPrecision(3), radius: String(+smallest.toPrecision(6)) }));\n            break;", "throw new KernelError(t('feature.filletTolerance', { tolerance: tolerance.toPrecision(3), radius: String(+smallest.toPrecision(6)) }));", 'tests/phase3/fillet-tolerance.test.ts'],
  ['packages/regen/src/engine.ts', '      if (!this.largestFilletRadius) throw e;\n', '', 'tests/phase8/fillet-by-face.test.ts'],
  ['packages/regen/src/recognize/reconstruct.ts', 'const REFUSALS: RebuildOptions = { largestFilletRadius: false };', 'const REFUSALS: RebuildOptions = {};', 'tests/phase8/recognize-rolling-ball.test.ts'],
];
for (const [file, from, to, test] of M) {
  const orig = readFileSync(file, 'utf8');
  const src = orig.replace(/\r\n/g, '\n');
  if (src.split(from).length !== 2) { console.log(`SKIP-NOT-ONCE ${file}`); process.exitCode = 1; continue; }
  const crlf = orig.includes('\r\n');
  let mutated = src.replace(from, to); if (crlf) mutated = mutated.replace(/\n/g, '\r\n');
  writeFileSync(file, mutated);
  try {
    const r = spawnSync('npx', ['vitest', 'run', test], { encoding: 'utf8', shell: true });
    const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
    console.log(`${r.status === 0 ? 'SURVIVED' : 'KILLED'} ${file} -> ${test}: ${(/Tests\s+(.*)/.exec(out) ?? [])[1]}`);
  } finally {
    writeFileSync(file, orig);
    if (readFileSync(file, 'utf8') !== orig) throw new Error('not restored: ' + file);
  }
}
