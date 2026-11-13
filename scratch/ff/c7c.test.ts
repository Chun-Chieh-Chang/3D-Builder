// Extending a B-spline by its own end polynomials (Geom_BSplineCurve.Segment outside its range): does the binding allow it, is the original stretch
// unchanged, are knots added (C0), and does the extended curve draft into one face without MakeDraft trapping (the fuzz seeds that trapped).
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { isTrap, Kernel } from '@3db/kernel';

const log = (m: string) => appendFileSync('scratch/ff/c7.log', m + String.fromCharCode(10));
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const L = (a: number[], b: number[], source: string) => ({ kind: 'line', a, b, source });

it('c7c', async () => {
  const kernel = await Kernel.load();
  const k = kernel as any;
  const oc = k.oc;
  const [w, h, mx, my] = (process.env.SHAPE ?? '28.72,25,14,32').split(',').map(Number) as [number, number, number, number];
  const outer = [L([0, 0], [w, 0], 'a'), L([w, 0], [w, h], 'b'), { kind: 'spline', points: [[w, h], [mx, my], [0, h]], source: 'c' }, L([0, h], [0, 0], 'd')];
  const s = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, 5]).shape;
  let ad: any = null;
  for (const ex = new oc.TopExp_Explorer(k.get(s), oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
    const a = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(ex.Current()));
    if (String(a.GetType()).includes('BSpline') && Math.abs(a.Value(a.FirstParameter()).Z()) < 1e-9) ad = a;
  }
  const [u0, u1] = [ad.FirstParameter(), ad.LastParameter()];
  const bs = oc.GeomConvert.CurveToBSplineCurve(new oc.Geom_TrimmedCurve(ad.BSpline(), u0, u1, true, true));
  const knots = (c: any) => { const out: string[] = []; for (let i = 1; i <= c.NbKnots(); i++) out.push(`${c.Knot(i).toFixed(3)}x${c.Multiplicity(i)}`); return out.join(' '); };
  const before = `deg ${bs.Degree()} poles ${bs.NbPoles()} knots [${knots(bs)}]`;
  const V = new oc.gp_Vec(), P = new oc.gp_Pnt();
  bs.D1(bs.FirstParameter(), P, V); const s0 = V.Magnitude();
  bs.D1(bs.LastParameter(), P, V); const s1 = V.Magnitude();
  const reach = 3;
  const [a0, a1] = [bs.FirstParameter() - reach / s0, bs.LastParameter() + reach / s1];
  let out: string;
  try {
    const ext = oc.GeomConvert.CurveToBSplineCurve(bs);
    ext.Segment(a0, a1, 1e-12);
    let worst = 0;
    for (let i = 0; i <= 40; i++) {
      const q = bs.Value(bs.FirstParameter() + ((bs.LastParameter() - bs.FirstParameter()) * i) / 40);
      worst = Math.max(worst, new oc.GeomAPI_ProjectPointOnCurve(q, ext).LowerDistance());
    }
    const e0 = ext.Value(ext.FirstParameter()), e1 = ext.Value(ext.LastParameter());
    const st = bs.Value(bs.FirstParameter()), en = bs.Value(bs.LastParameter());
    out = `after: range ${ext.FirstParameter().toFixed(4)}..${ext.LastParameter().toFixed(4)} knots [${knots(ext)}]; original stretch off by ${worst.toExponential(2)}; extended ${e0.Distance(st).toFixed(3)} and ${e1.Distance(en).toFixed(3)} mm`;
    // draft it alone, both ways
    const wire = new oc.BRepBuilderAPI_MakeWire(new oc.BRepBuilderAPI_MakeEdge(ext).Edge()).Wire();
    for (const internal of [true, false]) {
      try {
        const md = new oc.BRepOffsetAPI_MakeDraft(wire, new oc.gp_Dir(0, 0, 1), 0.08);
        md.SetOptions(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner, 1e-3, Math.PI);
        md.SetDraft(internal);
        md.Perform(40);
        let n = 0; for (const ex = new oc.TopExp_Explorer(md.Shape(), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) n++;
        out += ` | draft ${internal ? 'in' : 'out'}: ${n} face(s)`;
      } catch (e) { out += ` | draft ${internal ? 'in' : 'out'}: ${isTrap(e) ? 'TRAP' : 'threw'}`; if (isTrap(e)) break; }
    }
  } catch (e) {
    out = `Segment outside the range threw ${String(e).slice(0, 80)}`;
  }
  log(`segment ${process.env.SHAPE ?? 'outline'}: before ${before}; ${out}`);
}, 300_000);
