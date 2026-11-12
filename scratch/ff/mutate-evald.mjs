// C2.14d control: put EvalD1/EvalD2 back into the four derivative helpers, run the heap test, restore. Each replacement must match exactly once.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const F = 'D:/Self-developed_Apps/G3/3D-Builder/packages/kernel/src/exactRound.ts';
const BAK = 'D:/Self-developed_Apps/G3/3D-Builder/scratch/ff/exactRound.ts.bak-mutate';
const src = readFileSync(F, 'utf8'); copyFileSync(F, BAK);
const h = (s) => createHash('sha256').update(s).digest('hex');
const reps = [
  ['const [P, U, V] = outs(oc); ad.D1(u, v, P, U, V); return { p: xyz(P), du: xyz(U), dv: xyz(V) };',
    'const d = ad.EvalD1(u, v); return { p: take(d.Point), du: take(d.D1U), dv: take(d.D1V) };'],
  ['const [P, U, V, UU, VV, UV] = outs(oc); ad.D2(u, v, P, U, V, UU, VV, UV);\n  return { p: xyz(P), u: xyz(U), v: xyz(V), uu: xyz(UU), vv: xyz(VV), uv: xyz(UV) };',
    'const d = ad.EvalD2(u, v); return { p: take(d.Point), u: take(d.D1U), v: take(d.D1V), uu: take(d.D2U), vv: take(d.D2V), uv: take(d.D2UV) };'],
  ['const [P, D] = outs(oc); c.D1(t, P, D); return { p: xyz(P), d: xyz(D) };',
    'const d = c.EvalD1(t); return { p: take(d.Point), d: take(d.D1) };'],
  ['const [P, D, DD] = outs(oc); c.D2(t, P, D, DD); return { p: xyz(P), d: xyz(D), dd: xyz(DD) };',
    'const d = c.EvalD2(t); return { p: take(d.Point), d: take(d.D1), dd: take(d.D2) };'],
];
let m = src;
for (const [a, b] of reps) { const n = m.split(a).length - 1; if (n !== 1) { console.log('MUTATE-ABORT match count', n, a.slice(0, 50)); process.exit(2); } m = m.replace(a, b); }
let code = 0;
try {
  writeFileSync(F, m, 'utf8');
  try { execSync('npx vitest run packages/kernel/test/exact-round-heap.test.ts --silent=false', { stdio: 'inherit', cwd: 'D:/Self-developed_Apps/G3/3D-Builder' }); } catch (e) { code = e.status ?? 1; }
} finally {
  writeFileSync(F, src, 'utf8');
}
console.log('MUTATE-RESULT exit', code, 'restored', h(readFileSync(F, 'utf8')) === h(readFileSync(BAK, 'utf8')));
