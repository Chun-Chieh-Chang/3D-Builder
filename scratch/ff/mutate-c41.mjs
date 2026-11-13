// C4-1 mutation checks: each mutation breaks one piece of the change; the named tests must then fail. The file is restored after each run.
// usage: node scratch/ff/mutate-c41.mjs [name]
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const K = 'packages/kernel/src/kernel.ts', A = 'packages/regen/src/recognize/analyze.ts', R = 'packages/regen/src/recognize/reconstruct.ts';
const AF = 'packages/kernel/test/analytic-face.test.ts', RAF = 'tests/phase8/recognize-analytic-faces.test.ts', DR = 'tests/phase8/recognize-drafted-rounds.test.ts';
const M = [
  { name: 'analyticFace: no deviation check', file: K, from: 'return deviation <= tol ? { geometry, deviation } : null;', to: 'return { geometry, deviation };', tests: [AF, RAF] },
  { name: 'withAnalytic: never substitutes', file: A, from: '  if (!ctx?.on || faces.length === 0) return topo;', to: '  if (true) return topo;', tests: [RAF] },
  { name: 'reconstruct: no fine volume', file: R, from: 'const fine = rounds.substituted ? { eps: 1e-10 } : {};', to: 'const fine = {};', tests: [RAF] },
  { name: 'section: spline pieces not read as lines/arcs', file: A, from: '  if (simple) edges = asSimple(edges, 2 * reading!.tol);', to: '', tests: [RAF] },
  { name: 'section: corners not healed', file: A, from: '    return simple ? healCorners(loops, reading!.tol) : loops;', to: '    return loops;', tests: [RAF] },
  { name: 'rounds: analytic sharp edge only in closed form', file: A, from: "      if (closedForm || (!c.free && c.type !== 'fillet')) return closedForm;", to: '      if (!c.free) return closedForm;', tests: [DR] },
];
const only = process.argv[2];
for (const m of M.filter((x) => !only || x.name.includes(only))) {
  const orig = fs.readFileSync(m.file, 'utf8');
  if (!orig.includes(m.from)) { console.log(`ANCHOR MISSING: ${m.name}`); continue; }
  fs.writeFileSync(m.file, orig.replace(m.from, m.to));
  try {
    const r = spawnSync('npx.cmd', ['vitest', 'run', ...m.tests], { encoding: 'utf8', shell: true, maxBuffer: 1 << 26 });
    const out = r.stdout + r.stderr;
    const summary = (out.match(/Tests\s+.*$/m) ?? ['?'])[0];
    const failed = [...out.matchAll(/^\s+× (.*?)(?: \d+ms)?$/gm)].map((x) => x[1]).slice(0, 4);
    console.log(`${r.status === 0 ? 'SURVIVED' : 'KILLED  '} ${m.name} | ${summary.trim()} | ${failed.join(' ; ')}`);
  } finally {
    fs.writeFileSync(m.file, orig);
  }
}
