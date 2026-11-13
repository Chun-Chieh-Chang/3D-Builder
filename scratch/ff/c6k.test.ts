// The curve type of the spline edge that traps MakeDraft (seed 4, mid at w/2) against one that does not (OUTLINE), and MakeDraft on the wire after
// converting its edges to B-splines (BRepBuilderAPI_NurbsConvert).
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { isTrap, Kernel } from '@3db/kernel';
const log = (m: string) => appendFileSync('scratch/ff/c6.log', m + String.fromCharCode(10));
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const L = (a: number[], b: number[], source: string) => ({ kind: 'line', a, b, source });
it('c6k', async () => {
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const cases: Record<string, any[]> = {
    trap4: [L([0, 0], [38.091, 0], 'a'), L([38.091, 0], [38.091, 17.995], 'b'), { kind: 'spline', points: [[38.091, 17.995], [19.046, 15.941], [0, 17.995]], source: 'c' }, L([0, 17.995], [0, 0], 'd')],
    outline: [L([0, 0], [28.72, 0], 'a'), L([28.72, 0], [28.72, 25], 'b'), { kind: 'spline', points: [[28.72, 25], [14, 32], [0, 25]], source: 'c' }, L([0, 25], [0, 0], 'd')],
  };
  for (const [name, outer] of Object.entries(cases)) {
    const s = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, 5]).shape;
    let bottom: any = null;
    for (const ex = new oc.TopExp_Explorer(k.get(s), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
      const f = oc.TopoDS.Face(ex.Current()); const p = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(f, p, false, false);
      if (Math.abs(p.CentreOfMass().Z()) < 1e-9 && String(new oc.BRepAdaptor_Surface(f, true).GetType()).includes('Plane')) bottom = f;
    }
    const wire = oc.BRepTools.OuterWire(bottom);
    const types: string[] = [];
    for (const ex = new oc.TopExp_Explorer(wire, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
      const ad = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(ex.Current()));
      const t = String(ad.GetType()).replace('GeomAbs_', '');
      types.push(t === 'BSplineCurve' ? `BSpline deg ${ad.Degree()} poles ${ad.NbPoles()} rat ${ad.IsRational()} knots ${ad.NbKnots()}` : t === 'BezierCurve' ? `Bezier deg ${ad.Degree()}` : t);
    }
    const tryDraft = (w: any) => {
      try {
        const md = new oc.BRepOffsetAPI_MakeDraft(w, new oc.gp_Dir(0, 0, 1), 0.02);
        md.SetOptions(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner, 1e-3, Math.PI);
        md.SetDraft(true);
        md.Perform(new oc.Geom_Plane(new oc.gp_Pnt(0, 0, 5), new oc.gp_Dir(0, 0, 1)), false);
        return md.IsDone() ? 'ok' : 'not done';
      } catch (e) { return isTrap(e) ? 'TRAP' : `threw ${String(e).slice(0, 50)}`; }
    };
    const plainResult = tryDraft(wire);
    const conv = oc.TopoDS.Wire(new oc.BRepBuilderAPI_NurbsConvert(wire, true).Shape());
    const convTypes: string[] = [];
    for (const ex = new oc.TopExp_Explorer(conv, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) convTypes.push(String(new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(ex.Current())).GetType()).replace('GeomAbs_', ''));
    log(`curve ${name}: edges [${types.join('; ')}]; MakeDraft ${plainResult}; after NurbsConvert [${convTypes.join(',')}] MakeDraft ${plainResult === 'TRAP' ? '(skipped: module may be broken)' : tryDraft(conv)}`);
  }
}, 300_000);
