// The whole-curve branch of exactSectionCurve, step by step, on the periodic basis curve a STEP round trip gives.
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as any;
it('periodic', async () => {
  const kernel = await Kernel.load();
  const pts = Array.from({ length: 7 }, (_, i) => { const a = (2 * Math.PI * i) / 7; const r = 6 + 1.5 * Math.sin(3 * a); return [r * Math.cos(a), r * Math.sin(a)]; });
  const boss = kernel.extrude(XY, [{ outer: [{ kind: 'spline', closed: true, points: pts, source: 'c' }], holes: [] }] as any, [0, 0, 10]).shape;
  const id = kernel.importStep(new TextEncoder().encode(kernel.exportStep(boss, 'p'))).shape;
  const k = kernel as any; const oc = k.oc; const shp = k.get(id);
  for (const ex = new oc.TopExp_Explorer(shp, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
    const ad = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(ex.Current()), true);
    if (!String(ad.GetType()).includes('Extrusion')) continue;
    const c = oc.GeomConvert.CurveToBSplineCurve(ad.BasisCurve().BSpline());
    console.log('c closed', c.IsClosed(), 'periodic', c.IsPeriodic(), 'range', c.FirstParameter(), c.LastParameter());
    const piece = oc.GeomConvert.CurveToBSplineCurve(c);
    piece.SetNotPeriodic();
    const nk = piece.NbKnots(); const mults = []; for (let i = 1; i <= nk; i++) mults.push(piece.Multiplicity(i));
    const q = oc.GeomConvert.CurveToBSplineCurve(piece); q.Segment(q.FirstParameter(), q.LastParameter());
    const m2 = []; for (let i = 1; i <= q.NbKnots(); i++) m2.push(q.Multiplicity(i));
    const dev = Math.max(...Array.from({ length: 41 }, (_, i) => { const t = (7 * i) / 40; return q.Value(t).Distance(c.Value(t)); }));
    console.log('after Segment mults', m2.join(','), 'poles', q.NbPoles(), 'range', q.FirstParameter(), q.LastParameter(), 'max dev from c', dev, 'closed', q.IsClosed());
    console.log('after SetNotPeriodic periodic', piece.IsPeriodic(), 'deg', piece.Degree(), 'poles', piece.NbPoles(), 'mults', mults.join(','), 'range', piece.FirstParameter(), piece.LastParameter());
  }
  // the section edge itself
  const sec = kernel.sectionCurves(id, { ...XY, origin: [0, 0, 5] }, { u0: -60, u1: 60, v0: -60, v1: 60 });
  console.log(JSON.stringify(sec.map((x: any) => ({ kind: x.kind, spans: x.spans?.length }))));
}, 120000);
