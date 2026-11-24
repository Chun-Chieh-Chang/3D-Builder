// Probe: seed 39 (made uncut, refused cut) — why; and the exact rolling-ball round (exact = true) on cut bodies: outcome and exactRoundLog, cut vs uncut.
import { appendFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel, KernelError } from '@3db/kernel';
import { sample, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';

const LOG = 'out/prof46/s39.log';
writeFileSync(LOG, '');
const log = (s: string) => appendFileSync(LOG, s + '\n');
let k: Kernel;
const cutOf = (shape: unknown) => {
  const oc = k.oc as any;
  const div = new oc.ShapeUpgrade_ShapeDivideContinuity((k as any).get(shape));
  div.SetBoundaryCriterion(oc.GeomAbs_Shape.GeomAbs_C2); div.SetPCurveCriterion(oc.GeomAbs_Shape.GeomAbs_C2); div.SetSurfaceCriterion(oc.GeomAbs_Shape.GeomAbs_C2);
  div.Perform(true); const id = (k as any).put(div.Result()); div.delete();
  const ts = k.topology(id);
  const cap = ts.faces.findIndex((f) => f.geometry?.type === 'plane' && Math.abs(f.center[2]) < 1e-6 && (f.normal?.[2] ?? 0) > 0.9);
  const walls = ts.faces.flatMap((f, i) => (!f.geometry || f.geometry.type !== 'plane' ? [i] : []));
  return { id, edges: ts.edges.flatMap((e, i) => (e.faces.includes(cap) && e.faces.some((q) => walls.includes(q)) ? [i] : [])), faces: ts.faces.length };
};
const tryFillet = (name: string, shape: unknown, edges: number[], r: number, exact: boolean) => {
  const t0 = performance.now();
  try {
    const out = k.fillet(shape as never, edges, r, undefined, undefined, exact);
    const log2 = ((k as any).exactRoundLog ?? []).map((x: any) => x.outcome + (x.detail ? `(${String(x.detail).slice(0, 50)})` : '')).join(',');
    log(`  ${name}${exact ? ' exact' : ''}: ok ${((performance.now() - t0) / 1000).toFixed(2)}s volume ${k.massProps(out.shape).volume.toFixed(6)} faces ${k.topology(out.shape).faces.length}${exact ? ' exactLog ' + log2 : ''}`);
    k.release(out.shape);
  } catch (e) { if (!(e instanceof KernelError)) throw e; log(`  ${name}${exact ? ' exact' : ''}: refused ${((performance.now() - t0) / 1000).toFixed(2)}s ${e.message.slice(0, 120)}`); }
};
it('loads', async () => { k = await Kernel.load(); });
for (const seed of (process.env.SEEDS ?? '39,46,1,19,7,53').split(',').map(Number)) {
  it(`seed ${seed}`, () => {
    const s = sample(seed); const m = splineBoss(k, s.top, s.h); const c = cutOf(m.shape);
    log(`seed ${seed} r ${s.radius} faces ${k.topology(m.shape).faces.length} -> ${c.faces}, round edges 1 -> ${c.edges.length}`);
    if (seed !== 53) tryFillet('uncut', m.shape, m.edges, s.radius, false);
    tryFillet('cut', c.id, c.edges, s.radius, false);
    if (seed !== 53) tryFillet('uncut', m.shape, m.edges, s.radius, true);
    tryFillet('cut', c.id, c.edges, s.radius, true);
    k.release(c.id); k.release(m.shape);
  }, 600_000);
}
