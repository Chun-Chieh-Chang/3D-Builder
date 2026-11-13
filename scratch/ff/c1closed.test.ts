// Why a closed spline boss on a plate is not read by C1: section kinds, in-process and after a STEP round trip, with and without the plate.
import { beforeAll, it } from 'vitest';
import { Kernel } from '@3db/kernel';
let kernel: Kernel;
beforeAll(async () => { kernel = await Kernel.load(); });
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as any;
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
it('closed spline sections', () => {
  const pts = Array.from({ length: 7 }, (_, i) => { const a = (2 * Math.PI * i) / 7; const r = 6 + 1.5 * Math.sin(3 * a); return [r * Math.cos(a), r * Math.sin(a)]; });
  const bossOnly = kernel.extrude(XY, [{ outer: [{ kind: 'spline', closed: true, points: pts, source: 'c' }], holes: [] }] as any, [0, 0, 10]).shape;
  const sq = { outer: [[-20, -20], [20, -20], [20, 20], [-20, 20]].map((a, i, p) => L(a, p[(i + 1) % 4]!, 'b' + i)), holes: [] } as any;
  const plate = kernel.extrude({ ...XY, origin: [0, 0, -5] }, [sq], [0, 0, 5]).shape;
  const onPlate = kernel.boolean('fuse', plate, kernel.extrude({ ...XY, origin: [0, 0, -1] }, [{ outer: [{ kind: 'spline', closed: true, points: pts, source: 'c' }], holes: [] }] as any, [0, 0, 11]).shape).shape;
  const openPts = [[28.72, 25], [14, 32], [0, 25]];
  const openReg = { outer: [L([0, 0], [28.72, 0], 'a'), L([28.72, 0], openPts[0]!, 'b'), { kind: 'spline', points: openPts, source: 'c' }, L(openPts[2]!, [0, 0], 'd')], holes: [] } as any;
  const openOnPlate = kernel.boolean('fuse', kernel.extrude({ ...XY, origin: [-10, -10, -5] }, [{ outer: [[0, 0], [50, 0], [50, 50], [0, 50]].map((a, i, p) => L(a, p[(i + 1) % 4]!, 'q' + i)), holes: [] } as any], [0, 0, 5]).shape, kernel.extrude({ ...XY, origin: [0, 0, -1] }, [openReg], [0, 0, 11]).shape).shape;
  const rect = { u0: -60, u1: 60, v0: -60, v1: 60 };
  for (const [name, s] of [['boss only', bossOnly], ['closed on plate', onPlate], ['open on plate', openOnPlate]] as const) {
    for (const [how, id] of [['in process', s], ['step', kernel.importStep(new TextEncoder().encode(kernel.exportStep(s, 'p'))).shape]] as const) {
      const t = kernel.topology(id);
      const e = kernel.sectionCurves(id, { ...XY, origin: [0, 0, 5] }, rect);
      { const k = kernel as any; const oc = k.oc; const shp = k.get(id);
        for (const ex = new oc.TopExp_Explorer(shp, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
          const ad = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(ex.Current()), true);
          if (!String(ad.GetType()).includes('Extrusion')) continue;
          const bc = ad.BasisCurve(); const bs = bc.BSpline();
          const p0 = bs.Value(bs.FirstParameter()), p1 = bs.Value(bs.LastParameter());
          console.log(`   basis ${String(bc.GetType())} closed=${bs.IsClosed()} periodic=${bs.IsPeriodic()} gap=${p0.Distance(p1).toExponential(2)} deg=${bs.Degree()} poles=${bs.NbPoles()} dir=${[ad.Direction().X(), ad.Direction().Y(), ad.Direction().Z()].join(',')}`);
        } }
      console.log(`${name} / ${how}: faces ${t.faces.map((f) => f.surface).join(',')} | section ${e.map((x: any) => x.kind + (x.curve ? ':' + x.curve : '')).join(',')}`);
    }
  }
});
