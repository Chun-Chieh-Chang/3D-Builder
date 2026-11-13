// Mutation checks for the drafted extrusion of spline outlines (ADR 0251): each breaks one piece of kernel.ts; the draft tests must then fail. The
// anchor must occur exactly once (AGENTS §4 2026-11-07: a replacement that did not happen reads as all green). kernel.ts is backed up first and
// restored after each run, whatever happens. usage: node scratch/ff/mutate-draft.mjs [name filter]
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const K = 'packages/kernel/src/kernel.ts';
const TESTS = ['packages/kernel/test/draft-spline.test.ts', 'tests/phase3/extrude-draft-spline.test.ts'];
const M = [
  { name: 'every side drafted by DraftAngle', from: "return type.endsWith('Plane') || type.endsWith('Cylinder');", to: 'return true;' },
  { name: 'a line wall leans the wrong way', from: 'const out = inProfile(add(middle, left, nudge)) ? scale3(left, -1) : left;', to: 'const out = inProfile(add(middle, left, nudge)) ? left : scale3(left, -1);' },
  { name: 'an arc wall leans the wrong way', from: 'const k = inside ? -Math.tan(angle) : Math.tan(angle);', to: 'const k = inside ? Math.tan(angle) : -Math.tan(angle);' },
  { name: 'a curve wall leans the wrong way', from: 'const toward = reachUp * lean;', to: 'const toward = -reachUp * lean;' },
  { name: 'an arc shrinking to its apex is not refused', from: "if (!(apex > height)) throw new KernelError(t('feature.draftCloses', { inset: inset.toFixed(3) }));", to: '' },
  { name: 'a curve bending tighter than it moves is not refused', from: "if (!(loop > height)) throw new KernelError(t('feature.draftCloses', { inset: inset.toFixed(3) }));", to: '' },
  { name: 'a closing hole is not refused', from: "if (outer === angle > 0 && closes(wire)) throw new KernelError(t('feature.draftCloses', { inset: inset.toFixed(3) }));", to: '' },
  { name: 'tangent joins extended as corners', from: 'return 1 - dot3(p, q) > 1e-10;', to: 'return true;' },
  { name: 'every cell kept', from: '        if (inside) keep.push(cell);', to: '        keep.push(cell);' },
  { name: 'a draft that is no angle let through', from: 'if (spec.draft !== undefined && !(Number.isFinite(spec.draft) && Math.abs(spec.draft) < Math.PI / 2)) throw', to: 'if (false) throw' },
];
const only = process.argv[2];
const original = fs.readFileSync(K, 'utf8');
fs.writeFileSync('scratch/ff/kernel.before-mutation.ts', original);
// the baseline first: green, or every mutation would look killed (AGENTS §4 2026-11-07, ADR 0241)
const run = () => spawnSync('npx.cmd', ['vitest', 'run', ...TESTS], { encoding: 'utf8', shell: true, maxBuffer: 1 << 26 });
const base = run();
console.log(`baseline: ${base.status === 0 ? 'green' : 'RED'} | ${((base.stdout + base.stderr).match(/Tests\s+.*$/m) ?? ['?'])[0].trim()}`);
if (base.status !== 0) process.exit(1);
try {
  for (const m of M.filter((x) => !only || x.name.includes(only))) {
    const n = original.split(m.from).length - 1;
    if (n !== 1) { console.log(`ANCHOR x${n} (not counted): ${m.name}`); continue; }
    fs.writeFileSync(K, original.replace(m.from, m.to));
    try {
      const r = run();
      const out = r.stdout + r.stderr;
      const summary = (out.match(/Tests\s+.*$/m) ?? ['?'])[0].trim();
      const failed = [...out.matchAll(/^\s+× (.*?)(?: \d+ms)?$/gm)].map((x) => x[1]).slice(0, 2);
      console.log(`${r.status === 0 ? 'SURVIVED' : 'KILLED  '} ${m.name} | ${summary} | ${failed.join(' ; ').slice(0, 160)}`);
    } finally {
      fs.writeFileSync(K, original);
    }
  }
} finally {
  fs.writeFileSync(K, original);
}
