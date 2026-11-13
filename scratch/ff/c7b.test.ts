// Extending a spline edge as the same B-spline (GeomLib.ExtendCurveToPoint) instead of adding tangent lines: how the binding takes the curve, whether
// the original stretch is unchanged, and whether one edge drafts into one face.
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';

const log = (m: string) => appendFileSync('scratch/ff/c7.log', m + String.fromCharCode(10));
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const L = (a: number[], b: number[], source: string) => ({ kind: 'line', a, b, source });

it('c7b', async () => {
  const kernel = await Kernel.load();
  const k = kernel as any;
  const oc = k.oc;
  const outer = [L([0, 0], [28.72, 0], 'a'), L([28.72, 0], [28.72, 25], 'b'), { kind: 'spline', points: [[28.72, 25], [14, 32], [0, 25]], source: 'c' }, L([0, 25], [0, 0], 'd')];
  const s = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, 5]).shape;
  let spline: any = null;
  for (const ex = new oc.TopExp_Explorer(k.get(s), oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
    const e = oc.TopoDS.Edge(ex.Current());
    const ad = new oc.BRepAdaptor_Curve(e);
    if (String(ad.GetType()).includes('BSpline') && Math.abs(ad.Value(ad.FirstParameter()).Z()) < 1e-9) spline = { e, ad };
  }
  const { ad } = spline;
  const [t0, t1] = [ad.FirstParameter(), ad.LastParameter()];
  const bs = oc.GeomConvert.CurveToBSplineCurve(new oc.Geom_TrimmedCurve(ad.BSpline(), t0, t1, true, true));
  const p0 = ad.Value(t0), p1 = ad.Value(t1);
  const V = new oc.gp_Vec();
  ad.D1(t0, new oc.gp_Pnt(), V); const d0 = [V.X(), V.Y(), V.Z()].map((x) => x / V.Magnitude());
  ad.D1(t1, new oc.gp_Pnt(), V); const d1 = [V.X(), V.Y(), V.Z()].map((x) => x / V.Magnitude());
  const reach = 3;
  const tries: string[] = [];
  // tangent lines before and after, joined to the spline into one B-spline
  const seg = (a: any, b: any) => oc.GeomConvert.CurveToBSplineCurve(new oc.Geom_TrimmedCurve(new oc.GC_MakeLine(a, b).Value(), 0, a.Distance(b), true, true));
  const before = new oc.gp_Pnt(p0.X() - reach * d0[0]!, p0.Y() - reach * d0[1]!, p0.Z());
  const afterP = new oc.gp_Pnt(p1.X() + reach * d1[0]!, p1.Y() + reach * d1[1]!, p1.Z());
  const cc = new oc.GeomConvert_CompCurveToBSplineCurve(bs, oc.Convert_ParameterisationType.Convert_TgtThetaOver2);
  tries.push('add before ' + cc.Add(seg(before, p0), 1e-7, false, false, 0));
  tries.push('add after ' + cc.Add(seg(p1, afterP), 1e-7, true, false, 0));
  const curve = cc.BSplineCurve();
  // the original stretch unchanged: points of the old curve on the new one
  let worst = 0;
  const ext = oc.GeomConvert.CurveToBSplineCurve(curve);
  for (let i = 0; i <= 20; i++) {
    const q = ad.Value(t0 + ((t1 - t0) * i) / 20);
    const pr = new oc.GeomAPI_ProjectPointOnCurve(q, ext);
    worst = Math.max(worst, pr.LowerDistance());
  }
  const e2 = new oc.BRepBuilderAPI_MakeEdge(ext).Edge();
  const e2a = new oc.BRepAdaptor_Curve(e2);
  const len = (x: any) => { const p = new oc.GProp_GProps(); oc.BRepGProp.LinearProperties(x, p, false, false); return p.Mass(); };
  const w = new oc.BRepBuilderAPI_MakeWire(e2).Wire();
  const md = new oc.BRepOffsetAPI_MakeDraft(w, new oc.gp_Dir(0, 0, 1), 0.05);
  md.SetOptions(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner, 1e-3, Math.PI);
  md.SetDraft(true);
  md.Perform(10);
  let faces = 0;
  for (const ex = new oc.TopExp_Explorer(md.Shape(), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces++;
  log(`extend: ${tries.join(' | ')}; original stretch off the extended curve by ${worst.toExponential(2)}; length ${len(spline.e).toFixed(4)} -> ${len(e2).toFixed(4)} (ends ${e2a.Value(e2a.FirstParameter()).X().toFixed(3)},${e2a.Value(e2a.FirstParameter()).Y().toFixed(3)} .. ${e2a.Value(e2a.LastParameter()).X().toFixed(3)},${e2a.Value(e2a.LastParameter()).Y().toFixed(3)}); drafted into ${faces} face(s)`);
}, 300_000);
