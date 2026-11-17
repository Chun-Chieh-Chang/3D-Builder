// Mutation checks for recognizing drafted spline walls and rounds on them (ADR 0252): each breaks one piece; the tests must then fail. The anchor must occur
// exactly once (AGENTS §4 2026-11-07: a replacement that did not happen reads as all green). The files are backed up first and restored after each run,
// whatever happens; the baseline runs first (ADR 0241). usage: node scratch/ff/mutate-drafted-recognition.mjs [name filter]
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const K = 'packages/kernel/src/kernel.ts';
const A = 'packages/regen/src/recognize/analyze.ts';
const TESTS = ['packages/kernel/test/drafted-wall.test.ts', 'tests/phase8/recognize-drafted-spline.test.ts'];
const M = [
  { file: K, name: 'a wall off its exact draft read as one', from: '    if (!(deviation <= tol)) return null;\n    return { rail: ra,', to: '    return { rail: ra,' },
  { file: K, name: 'rails at the face\'s bounds, not the surface\'s', from: 'const rails = (ruledU ? [s.UIso(full.FirstUParameter()), s.UIso(full.LastUParameter())] : [s.VIso(full.FirstVParameter()), s.VIso(full.LastVParameter())])', to: 'const rails = (ruledU ? [s.UIso(u0), s.UIso(u1)] : [s.VIso(v0), s.VIso(v1)])' },
  { file: K, name: 'the drawn curve not rebuilt exactly on the rail\'s plane', from: '      if (Math.abs(c.Offset()) <= 1e-12) {', to: '      if (false) {' },
  { file: K, name: 'a stretch\'s end not put on the rail\'s knot', from: '      [lo, hi] = [snap(lo), snap(hi)];', to: '' },
  { file: K, name: 'one C0 approximation of a stretch only', from: 'for (const [tol, deg] of [[1e-8, 8], [1e-7, 14], [1e-8, 14]] as const) {', to: 'for (const [tol, deg] of [[1e-9, 14]] as const) {' },
  { file: K, name: 'the far curve as ADR 0251 made it (degree 14 to 1e-9)', from: 'let ap = arena.own(new oc.GeomConvert_ApproxCurve(offset, 1e-8, oc.GeomAbs_Shape.GeomAbs_C1, 200, 5));', to: 'let ap = arena.own(new oc.GeomConvert_ApproxCurve(offset, 1e-9, oc.GeomAbs_Shape.GeomAbs_C1, 200, 14));' },
  { file: K, name: 'a section\'s ends matched to 1e-7 on a drafted wall', from: '          const endTol = Math.min(WALL_CURVE_END, Math.max(DRAFTED_WALL_READ, oc.BRep_Tool.Tolerance(edge)));', to: '          const endTol = 1e-7;' },
  { file: A, name: 'no drafted wall taken as a wall', from: '        v = drafted && Math.abs(drafted.lean) <= MAX_DRAFT + 1e-12 ? drafted.lean : null;', to: '        v = null;' },
  { file: A, name: 'corners not put on the body\'s vertices', from: '          return near ? near.c : end;', to: '          return end;' },
  { file: A, name: 'a section\'s spline pieces not joined', from: '    a = a.map(join);\n    b = b.map(join);', to: '' },
  { file: A, name: 'the stretch chosen by a lerp of the middles', from: '        const on = wall(A, B, nurbsAt(g, 0.5), 1.5 * step + 1e-6);', to: '        const on = wall(A, B, lerp(nurbsAt(f, 0.5), nurbsAt(g, 0.5)), 1e-3);' },
  { file: A, name: 'a freeform face no round support', from: '    const b = bestOf(i, tangent(i));', to: '    const b = bestOf(i, tangent(i).filter((n) => !maybe.has(n)));' },
  { file: A, name: 'cap heights grouped as signed zero strings', from: '(Math.round(dot(f.center, d) * 1e7) / 1e7 + 0).toFixed(7)', to: 'dot(f.center, d).toFixed(7)' },
  { file: A, name: 'drafted sections at a quarter and three quarters regardless of kept faces', from: '  const [f1, f3] = [band[0] + 0.25 * (band[1] - band[0]), band[0] + 0.75 * (band[1] - band[0])];', to: '  const [f1, f3] = [0.25, 0.75];' },
];
const only = process.argv[2];
const originals = Object.fromEntries([K, A].map((f) => [f, fs.readFileSync(f, 'utf8')]));
for (const [f, s] of Object.entries(originals)) fs.writeFileSync(`scratch/ff/${f.split('/').pop()}.before-mutation-0252`, s);
const run = () => spawnSync('npx.cmd', ['vitest', 'run', ...TESTS], { encoding: 'utf8', shell: true, maxBuffer: 1 << 26 });
const restore = () => { for (const [f, s] of Object.entries(originals)) fs.writeFileSync(f, s); };
const base = run();
console.log(`baseline: ${base.status === 0 ? 'green' : 'RED'} | ${((base.stdout + base.stderr).match(/Tests\s+.*$/m) ?? ['?'])[0].trim()}`);
if (base.status !== 0) process.exit(1);
try {
  for (const m of M.filter((x) => !only || x.name.includes(only))) {
    const src = originals[m.file];
    const n = src.split(m.from).length - 1;
    if (n !== 1) { console.log(`ANCHOR x${n} (not counted): ${m.name}`); continue; }
    fs.writeFileSync(m.file, src.replace(m.from, m.to));
    try {
      const r = run();
      const out = r.stdout + r.stderr;
      const summary = (out.match(/Tests\s+.*$/m) ?? ['?'])[0].trim();
      const failed = [...out.matchAll(/^\s+× (.*?)(?: \d+ms)?$/gm)].map((x) => x[1]).slice(0, 2);
      console.log(`${r.status === 0 ? 'SURVIVED' : 'KILLED  '} ${m.name} | ${summary} | ${failed.join(' ; ').slice(0, 160)}`);
    } finally {
      restore();
    }
  }
} finally {
  restore();
}
