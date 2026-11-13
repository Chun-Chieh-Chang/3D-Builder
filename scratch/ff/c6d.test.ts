// How far MakeDraft's spline wall is from the exact draft surface. The exact surface's section at height z is the base curve offset in its plane by
// z·tan(α); for a point P of the wall at height z the distance to it is | dist_xy(P, base curve) − z·tan(α) | (offsets small against the curvature).
// 21 × 21 points per wall; also for the drafted planes (control: should be 0), for H = 10 and 30.
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { XY } from '../../tests/phase8/recognize-rolling-ball.kit';

const log = (m: string) => appendFileSync('scratch/ff/c6.log', m + String.fromCharCode(10));
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });

it('c6d', async () => {
  const kernel = await Kernel.load();
  const k = kernel as any;
  const oc = k.oc;
  const outer = [L([0, 0], [28.72, 0], 'a'), L([28.72, 0], [28.72, 25], 'b'), { kind: 'spline', points: [[28.72, 25], [14, 32], [0, 25]], source: 'c' }, L([0, 25], [0, 0], 'd')];
  for (const H of [10, 30]) for (const deg of [1.5, 5, -3]) {
    const a = (deg * Math.PI) / 180;
    const base = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, H]).shape;
    let bottom: any = null;
    for (const ex = new oc.TopExp_Explorer(k.get(base), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
      const f = oc.TopoDS.Face(ex.Current());
      const p = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(f, p, false, false);
      if (Math.abs(p.CentreOfMass().Z()) < 1e-9 && String(new oc.BRepAdaptor_Surface(f, true).GetType()).includes('Plane')) bottom = f;
    }
    const wire = oc.BRepTools.OuterWire(bottom);
    // base edges by kind
    const baseEdges: { curve: any; first: number; last: number; kind: string }[] = [];
    for (const ex = new oc.TopExp_Explorer(wire, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
      const e = oc.TopoDS.Edge(ex.Current());
      const ad = new oc.BRepAdaptor_Curve(e);
      const got = oc.BRep_Tool.Curve(e, 0, 0);
      baseEdges.push({ curve: got?.returnValue ?? got, first: ad.FirstParameter(), last: ad.LastParameter(), kind: String(ad.GetType()).replace('GeomAbs_', '') });
    }
    const md = new oc.BRepOffsetAPI_MakeDraft(wire, new oc.gp_Dir(0, 0, 1), a);
    md.SetOptions(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner, 1e-3, Math.PI / 2);
    md.SetDraft(a > 0);
    md.Perform(new oc.Geom_Plane(new oc.gp_Pnt(0, 0, H), new oc.gp_Dir(0, 0, 1)), false);
    const sh = md.Shape();
    const rows: string[] = [];
    for (const ex = new oc.TopExp_Explorer(sh, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
      const f = oc.TopoDS.Face(ex.Current());
      const ad = new oc.BRepAdaptor_Surface(f, true);
      const type = String(ad.GetType()).replace('GeomAbs_', '');
      const [u0, u1, v0, v1] = [ad.FirstUParameter(), ad.LastUParameter(), ad.FirstVParameter(), ad.LastVParameter()];
      let worst = 0, n = 0;
      const P = new oc.gp_Pnt();
      for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
        const [uu, vv] = [u0 + ((u1 - u0) * (i + 0.5)) / 21, v0 + ((v1 - v0) * (j + 0.5)) / 21];
        // only points inside the face (the parameter rectangle of a trimmed face runs past its edges)
        const cls = new oc.BRepClass_FaceClassifier(f, new oc.gp_Pnt2d(uu + 1e-9, vv + 1e-9), 1e-9);
        const inside = String(cls.State()).includes('TopAbs_IN');
        cls.delete();
        if (!inside) continue;
        ad.D0(uu, vv, P);
        const z = P.Z();
        if (z < 1e-6 || z > H - 1e-6) continue;
        // its foot on the nearest base edge, in the plane z = 0
        let best = Infinity;
        for (const be of baseEdges) {
          const pr = new oc.GeomAPI_ProjectPointOnCurve(new oc.gp_Pnt(P.X(), P.Y(), 0), be.curve, be.first, be.last);
          if (pr.NbPoints() > 0) best = Math.min(best, pr.LowerDistance());
          pr.delete();
        }
        if (!Number.isFinite(best)) continue;
        worst = Math.max(worst, Math.abs(best - z * Math.tan(Math.abs(a))));
        n++;
      }
      if (n) rows.push(`${type} ${worst.toExponential(2)} mm (${n} pts)`);
      ad.delete();
    }
    log(`H ${H} draft ${deg}°: distance from the exact draft (inside the face) — ${rows.join('; ')}`);
    kernel.release(base);
  }
}, 900_000);
