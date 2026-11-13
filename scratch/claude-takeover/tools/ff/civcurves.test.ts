import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
const D = process.env.STEP_DIR!;
it('civ exact curves', async () => {
  const kernel = await Kernel.load();
  const imp = kernel.importStep(new Uint8Array(readFileSync(`${D}/tmp/CIV0000467治具_step.STEP`)));
  const frame = { origin: [0, 0, 9.85] as [number, number, number], xDir: [1, 0, 0] as [number, number, number], yDir: [0, 1, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
  const t0 = performance.now();
  const es = kernel.sectionCurves(imp.shape, frame, { u0: -80, u1: 60, v0: -55, v1: 55 });
  const ms = performance.now() - t0;
  const k: Record<string, number> = {}; let poles = 0; const degs: Record<number, number> = {}; let rational = 0;
  for (const e of es) { k[e.kind] = (k[e.kind] ?? 0) + 1; if (e.kind === 'nurbs') { poles += e.poles.length; degs[e.degree] = (degs[e.degree] ?? 0) + 1; if (e.weights) rational++; } }
  // chaining: every curve end meets another curve's end
  const ends: [number, number][] = [];
  for (const e of es) if ('a' in e && 'b' in e) ends.push(e.a as any, e.b as any);
  const lonely = ends.filter((p, i) => !ends.some((q, j) => j !== i && Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-7)).length;
  writeFileSync(process.env.OUT!, JSON.stringify({ ms: Math.round(ms), kinds: k, poles, degs, rational, lonely }, null, 1));
}, 600000);
