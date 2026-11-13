// Can the MakeDraft trap be avoided by handing it the wire in another form? JOB = <case>:<form>, case trap4 (the middle point at w/2 + 0.0005, which
// traps) or ok4 (+0.0004, which does not); form: as-is, nurbs (BRepBuilderAPI_NurbsConvert of the wire), reparam (each curve edge rebuilt from its
// B-spline with knots spread to [0, 1]), approx (each curve edge re-approximated to 1e-9 by GeomConvert_ApproxCurve). One process per job.
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { isTrap, Kernel } from '@3db/kernel';
const log = (m: string) => appendFileSync('scratch/ff/c6.log', m + String.fromCharCode(10));
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const L = (a: number[], b: number[], source: string) => ({ kind: 'line', a, b, source });
it('c6m', async () => {
  const [name, form] = process.env.JOB!.split(':');
  const dx = name === 'trap4' ? 0.0005 : 0.0004;
  const [w, h, my] = [38.091, 17.995, 15.941];
  const outer = [L([0, 0], [w, 0], 'a'), L([w, 0], [w, h], 'b'), { kind: 'spline', points: [[w, h], [w / 2 + dx, my], [0, h]], source: 'c' }, L([0, h], [0, 0], 'd')];
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const s = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, 5]).shape;
  let bottom: any = null;
  for (const ex = new oc.TopExp_Explorer(k.get(s), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
    const f = oc.TopoDS.Face(ex.Current()); const p = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(f, p, false, false);
    if (Math.abs(p.CentreOfMass().Z()) < 1e-9 && String(new oc.BRepAdaptor_Surface(f, true).GetType()).includes('Plane')) bottom = f;
  }
  let wire = oc.BRepTools.OuterWire(bottom);
  let note = '';
  try {
    if (form === 'nurbs') wire = oc.TopoDS.Wire(new oc.BRepBuilderAPI_NurbsConvert(wire, true).Shape());
    if (form === 'reparam' || form === 'approx') {
      const mw = new oc.BRepBuilderAPI_MakeWire();
      for (const ex = new oc.BRepTools_WireExplorer(wire); ex.More(); ex.Next()) {
        const e = ex.Current();
        const ad = new oc.BRepAdaptor_Curve(e);
        if (!String(ad.GetType()).includes('BSpline')) { mw.Add(e); continue; }
        let c = oc.GeomConvert.CurveToBSplineCurve(new oc.Geom_TrimmedCurve(ad.BSpline(), ad.FirstParameter(), ad.LastParameter(), true, true));
        if (form === 'reparam') {
          const n = c.NbKnots(); const ks = new oc.TColStd_Array1OfReal(1, n);
          const [k0, k1] = [c.Knot(1), c.Knot(n)];
          for (let i = 1; i <= n; i++) ks.SetValue(i, (c.Knot(i) - k0) / (k1 - k0));
          c.SetKnots(ks);
        } else {
          const ap = new oc.GeomConvert_ApproxCurve(c, 1e-9, oc.GeomAbs_Shape.GeomAbs_C2, 50, 9);
          note = ` (approx done ${ap.IsDone()}, error ${ap.MaxError().toExponential(1)})`;
          c = ap.Curve();
        }
        mw.Add(new oc.BRepBuilderAPI_MakeEdge(c).Edge());
      }
      wire = mw.Wire();
    }
  } catch (e) { log(`form ${process.env.JOB}: making the wire threw ${String(e).slice(0, 80)}`); return; }
  let out: string;
  try {
    const md = new oc.BRepOffsetAPI_MakeDraft(wire, new oc.gp_Dir(0, 0, 1), 0.02);
    md.SetOptions(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner, 1e-3, Math.PI);
    md.SetDraft(true);
    md.Perform(new oc.Geom_Plane(new oc.gp_Pnt(0, 0, 10), new oc.gp_Dir(0, 0, 1)), false);
    out = md.IsDone() ? 'ok' : 'not done';
  } catch (e) { out = isTrap(e) ? 'TRAP' : `threw ${String(e).slice(0, 60)}`; }
  log(`form ${process.env.JOB}: MakeDraft ${out}${note}`);
}, 300_000);
