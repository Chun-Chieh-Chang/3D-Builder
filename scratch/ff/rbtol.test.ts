// Hypothesis: the edge wall ∩ plate of the plain body is OCCT's approximated intersection, off the true wall by about its declared tolerance.
// For SEEDS: the plain edge's BRep tolerance; the largest distance (Newton foot) of 200 points along its own 3D curve to the wall's surface and the
// plate's plane; same for the rebuilt-from-sketch edge is measured in recognition (not here).
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { sample, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';
import { supportOf } from '../../packages/kernel/src/exactRound';
import { Arena, ShapeIndex } from '../../packages/kernel/src/occt';
it('tol', async () => {
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  for (const seed of (process.env.SEEDS ?? '51,99,45,2').split(',').map(Number)) {
    const s = sample(seed); const m = splineBoss(kernel, s.top, s.h);
    const arena = new Arena();
    const E = ShapeIndex.of(oc, k.get(m.shape), oc.TopAbs_ShapeEnum.TopAbs_EDGE, arena).keys;
    const F = ShapeIndex.of(oc, k.get(m.shape), oc.TopAbs_ShapeEnum.TopAbs_FACE, arena).keys;
    const t = kernel.topology(m.shape);
    const e = t.edges[m.edges[0]!]!;
    const edge = oc.TopoDS.Edge(E[m.edges[0]!]);
    const tol = oc.BRep_Tool.Tolerance(edge);
    const ad = new oc.BRepAdaptor_Curve(edge);
    const c = ad.GetType ? String(ad.GetType()?.value ?? ad.GetType()) : '?';
    const S = e.faces.map((f) => supportOf(oc, oc.TopoDS.Face(F[f])));
    const worst = S.map(() => 0);
    for (let i = 0; i <= 200; i++) {
      const p = ad.Value(ad.FirstParameter() + ((ad.LastParameter() - ad.FirstParameter()) * i) / 200);
      const q: [number, number, number] = [p.X(), p.Y(), p.Z()]; p.delete();
      S.forEach((x, j) => { worst[j] = Math.max(worst[j]!, x.foot(q, x.proj(q))); });
    }
    console.log(`RBT seed ${seed} edge curve ${c} tolerance ${tol.toExponential(2)} faces ${e.faces.map((f) => t.faces[f]!.surface).join('/')} curve off them ${worst.map((w) => w.toExponential(2)).join(' ')}`);
    S.forEach((x) => x.release()); ad.delete(); arena.dispose();
  }
}, 900_000);
