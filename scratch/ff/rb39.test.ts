// Why seed SEED's exact round is not read as a rolling ball: arcSections, rollingBall at tol 1, points seen inside, on the STEP round trip.
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { sample, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';
import { arcSections } from '../../packages/kernel/src/roundRecognition';
import { Arena, ShapeIndex } from '../../packages/kernel/src/occt';
it('39', async () => {
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const s = sample(Number(process.env.SEED ?? 39)); const m = splineBoss(kernel, s.top, s.h);
  const made = kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, true).shape;
  console.log('R39 log', JSON.stringify(k.exactRoundLog));
  const back = kernel.importStep(new TextEncoder().encode(kernel.exportStep(made, 'p'))).shape;
  for (const [label, body] of [['made', made], ['step', back]] as const) {
    const t = kernel.topology(body); const sm = kernel.smoothEdges(body, t.edges.map((_, i) => i));
    const nb = (f: number) => [...new Set(t.edges.flatMap((e, x) => (sm[x] && e.faces.includes(f) ? e.faces.filter((q) => q !== f) : [])))];
    const arena = new Arena(); const F = ShapeIndex.of(oc, k.get(body), oc.TopAbs_ShapeEnum.TopAbs_FACE, arena).keys;
    t.faces.forEach((f, i) => {
      if (f.surface === 'plane') return;
      const face = oc.TopoDS.Face(F[i]);
      const ad = new oc.BRepAdaptor_Surface(face, true);
      console.log(`R39 ${label} face ${i} ${f.surface} smooth-neighbours ${JSON.stringify(nb(i))} range u ${ad.FirstUParameter().toFixed(4)}..${ad.LastUParameter().toFixed(4)} v ${ad.FirstVParameter().toFixed(4)}..${ad.LastVParameter().toFixed(4)} arc ${JSON.stringify(arcSections(oc, face))}` +
        (nb(i).length === 2 ? ` ball ${JSON.stringify(kernel.rollingBall(body, i, nb(i) as [number, number], 1))}` : ''));
      ad.delete();
    });
    arena.dispose();
  }
}, 600_000);
