// Are sharpEdge's points on both supports' surfaces? For SEEDS, on the made body and on its STEP round trip: per support the largest distance by the
// projector (supportOf.dist, Extrema Grad) and by Newton from the projector's foot (supportOf.foot), and the distance to the plain body's edge.
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { sample, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';
import { supportOf } from '../../packages/kernel/src/exactRound';
it('sharp', async () => {
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  for (const seed of (process.env.SEEDS ?? '51,99,45,2').split(',').map(Number)) {
    const s = sample(seed); const m = splineBoss(kernel, s.top, s.h);
    const made = kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, true).shape;
    const back = kernel.importStep(new TextEncoder().encode(kernel.exportStep(made, 'p'))).shape;
    for (const [label, body] of [['made', made], ['step', back]] as const) {
      const t = kernel.topology(body); const sm = kernel.smoothEdges(body, t.edges.map((_, i) => i));
      const nb = (f: number) => [...new Set(t.edges.flatMap((e, x) => (sm[x] && e.faces.includes(f) ? e.faces.filter((q) => q !== f) : [])))];
      const round = t.faces.findIndex((f, i) => f.surface === 'bsplinesurface' && nb(i).length === 2 && kernel.rollingBall(body, i, nb(i) as [number, number], 1) !== null);
      if (round < 0) { console.log(`RBS seed ${seed} ${label} no round`); continue; }
      const sup = nb(round) as [number, number];
      const sh = kernel.sharpEdge(body, round, sup)!;
      const faces: any[] = [];
      for (const ex = new oc.TopExp_Explorer(k.get(body), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
      const S = sup.map((i) => supportOf(oc, faces[i]));
      const byProj = S.map((x) => Math.max(...sh.points.map((p) => x.dist(p))));
      const byNewton = S.map((x) => Math.max(...sh.points.map((p) => x.foot(p, x.proj(p)))));
      const ds = kernel.distancesToEdge(m.shape, m.edges[0]!, sh.points);
      console.log(`RBS seed ${seed} ${label} supports ${sup.map((i) => t.faces[i]!.surface).join('/')} proj ${byProj.map((x) => x.toExponential(2)).join(' ')} newton ${byNewton.map((x) => x.toExponential(2)).join(' ')} plain-edge max ${Math.max(...ds.map((x) => x ?? Infinity)).toExponential(2)}`);
      S.forEach((x) => x.release());
    }
  }
}, 900_000);
