// Seed SEED: every fillet call recognition makes (edges, radius, exact), what it threw, the exact-round log; and the same edge with OCCT's round.
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { recognizeStep, sample, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';
import * as await_occt from '../../packages/kernel/src/occt';
import * as await_sup from '../../packages/kernel/src/exactRound';
it('52', async () => {
  const kernel = await Kernel.load(); const solver = await PlaneGcsSolver.create(); const k = kernel as any;
  const s = sample(Number(process.env.SEED ?? 52)); const m = splineBoss(kernel, s.top, s.h);
  const made = kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, true).shape;
  console.log('R52 made', JSON.stringify(k.exactRoundLog), 'radius', s.radius);
  const f = kernel.fillet.bind(kernel);
  k.fillet = (sh: any, edges: number[], r: number, l: any, a: any, exact: any) => {
    const t = kernel.topology(sh);
    const info = edges.map((e) => `${e}:${t.edges[e]?.curve} len ${t.edges[e]?.length.toFixed(3)} faces ${t.edges[e]?.faces.map((q) => t.faces[q]!.surface).join('/')}`);
    try { const o = f(sh, edges, r, l, a, exact); console.log('R52 fillet ok', r, exact, info.join('; '), JSON.stringify(k.exactRoundLog)); return o; }
    catch (e: any) {
      console.log('R52 fillet THREW', r, exact, info.join('; '), String(e?.message ?? e).slice(0, 200));
      console.log('R52   rebuilt check', JSON.stringify(kernel.check(sh)).slice(0, 300), 'plain check', JSON.stringify(kernel.check(m.shape)).slice(0, 100));
      const oc = k.oc; const { Arena, ShapeIndex } = await_occt;
      const ar = new Arena(); const E = ShapeIndex.of(oc, k.get(sh), oc.TopAbs_ShapeEnum.TopAbs_EDGE, ar).keys; const E0 = ShapeIndex.of(oc, k.get(m.shape), oc.TopAbs_ShapeEnum.TopAbs_EDGE, ar).keys;
      console.log('R52   edge tolerance rebuilt', oc.BRep_Tool.Tolerance(oc.TopoDS.Edge(E[edges[0]!])), 'plain', oc.BRep_Tool.Tolerance(oc.TopoDS.Edge(E0[m.edges[0]!])), 'max vertex tol rebuilt', Math.max(...t.vertices.map((_, i) => i).slice(0, 0)));
      {
        const { supportOf } = await_sup;
        const edge = oc.TopoDS.Edge(E[edges[0]!]); const ad = new oc.BRepAdaptor_Curve(edge);
        const FK = ShapeIndex.of(oc, k.get(sh), oc.TopAbs_ShapeEnum.TopAbs_FACE, ar).keys;
        const S = t.edges[edges[0]!]!.faces.map((q) => supportOf(oc, oc.TopoDS.Face(FK[q])));
        const w = S.map(() => 0);
        for (let i = 0; i <= 400; i++) { const p = ad.Value(ad.FirstParameter() + ((ad.LastParameter() - ad.FirstParameter()) * i) / 400); const q: any = [p.X(), p.Y(), p.Z()]; p.delete(); S.forEach((x, j) => { w[j] = Math.max(w[j]!, x.foot(q, x.proj(q))); }); }
        console.log('R52   rebuilt edge curve off its faces', w.map((x) => x.toExponential(2)).join(' '), 'faces', t.edges[edges[0]!]!.faces.map((q) => t.faces[q]!.surface).join('/'));
        S.forEach((x) => x.release()); ad.delete();
      }
      ar.dispose();
      try { const pl = f(m.shape, m.edges, r, l, a, false); void pl; console.log('R52   plain body OCCT round at this r: ok'); } catch { console.log('R52   plain body OCCT round at this r: THREW'); }
      try { f(sh, edges, r, l, a, false); console.log('R52   same edge with OCCT round: ok'); } catch (e2: any) { console.log('R52   same edge with OCCT round: THREW', String(e2?.message ?? e2).slice(0, 120)); }
      throw e;
    }
  };
  try { const r = await recognizeStep(kernel, solver, made); console.log('R52 rebuilt', r.report.volumeError); } catch (e: any) { console.log('R52 refused', String(e.message).slice(0, 150)); }
}, 600_000);
