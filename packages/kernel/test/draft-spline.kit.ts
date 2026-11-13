/** Shared by the drafted-spline tests (ADR 0251): the outline they use and the measure of how far a drafted wall is from the exact draft. */
import type { Kernel, OpResult } from '../src';

const L = (a: [number, number], b: [number, number], source: string) => ({ kind: 'line' as const, a, b, source });
export const SPLINE = { kind: 'spline', points: [[28.72, 25], [14, 32], [0, 25]], source: 'c' };
export const OUTLINE = [L([0, 0], [28.72, 0], 'a'), L([28.72, 0], [28.72, 25], 'b'), SPLINE, L([0, 25], [0, 0], 'd')];

/**
 * Per wall of the drafted extrusion (a face named by a profile edge): the largest | horizontal distance to that edge's curve − z·tan|α| | over
 * 21 × 21 points inside the face (BRepClass_FaceClassifier: the parameter rectangle of a trimmed face runs past its edges), with the face's surface
 * type. Each wall is measured against its own edge (from the straight extrusion's face of the same name, at z = 0), never the nearest edge: a
 * widening wall runs past its edge's ends at a corner, where the nearest edge is another one. A line is measured as the whole line; a curve only
 * where the point has a foot square to it inside the edge (a point past its end is counted as skipped).
 */
export function offDraft(kernel: Kernel, drafted: OpResult, straight: OpResult, angle: number, H: number): { source: string; type: string; worst: number; n: number; skipped: number }[] {
  const oc = kernel.oc as any;
  const k = kernel as any;
  const sourceOf = (o: OpResult['faceOrigins'][number]) => o.find((x) => x.rel === 'generated' && x.kind === 'profileEdge') as { source: string } | undefined;
  const faces = (r: OpResult) => {
    const out: any[] = [];
    for (const ex = new oc.TopExp_Explorer(k.get(r.shape), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) out.push(oc.TopoDS.Face(ex.Current()));
    return out;
  };
  // the base curve of each profile edge: the straight wall's edge at z = 0
  const base = new Map<string, { curve: any; first: number; last: number; line: boolean }>();
  faces(straight).forEach((f, i) => {
    const s = sourceOf(straight.faceOrigins[i]!);
    if (!s) return;
    for (const ex = new oc.TopExp_Explorer(f, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
      const e = oc.TopoDS.Edge(ex.Current());
      const ad = new oc.BRepAdaptor_Curve(e);
      const [a, b] = [ad.Value(ad.FirstParameter()), ad.Value(ad.LastParameter())];
      if (Math.abs(a.Z()) < 1e-9 && Math.abs(b.Z()) < 1e-9 && !base.has(s.source)) {
        const got = oc.BRep_Tool.Curve(e, 0, 0);
        base.set(s.source, { curve: got?.returnValue ?? got, first: ad.FirstParameter(), last: ad.LastParameter(), line: String(ad.GetType()).includes('Line') });
      }
      ad.delete();
    }
  });
  const out: { source: string; type: string; worst: number; n: number; skipped: number }[] = [];
  faces(drafted).forEach((f, i) => {
    const s = sourceOf(drafted.faceOrigins[i]!);
    const b = s && base.get(s.source);
    if (!s || !b) return;
    const ad = new oc.BRepAdaptor_Surface(f, true);
    const type = String(ad.GetType()).replace('GeomAbs_', '');
    const [u0, u1, v0, v1] = [ad.FirstUParameter(), ad.LastUParameter(), ad.FirstVParameter(), ad.LastVParameter()];
    const P = new oc.gp_Pnt();
    let worst = 0;
    let n = 0;
    let skipped = 0;
    for (let i2 = 0; i2 < 21; i2++) {
      for (let j = 0; j < 21; j++) {
        const [u, v] = [u0 + ((u1 - u0) * (i2 + 0.5)) / 21, v0 + ((v1 - v0) * (j + 0.5)) / 21];
        const cls = new oc.BRepClass_FaceClassifier(f, new oc.gp_Pnt2d(u + 1e-9, v + 1e-9), 1e-9);
        const inside = String(cls.State()).includes('TopAbs_IN');
        cls.delete();
        if (!inside) continue;
        ad.D0(u, v, P);
        const z = P.Z();
        if (z < 1e-6 || z > H - 1e-6) continue;
        const foot = new oc.gp_Pnt(P.X(), P.Y(), 0);
        const pr = b.line ? new oc.GeomAPI_ProjectPointOnCurve(foot, b.curve) : new oc.GeomAPI_ProjectPointOnCurve(foot, b.curve, b.first, b.last);
        const d = pr.NbPoints() > 0 ? pr.LowerDistance() : NaN;
        pr.delete();
        foot.delete();
        if (!Number.isFinite(d)) {
          skipped++;
          continue;
        }
        worst = Math.max(worst, Math.abs(d - z * Math.tan(Math.abs(angle))));
        n++;
      }
    }
    P.delete();
    ad.delete();
    out.push({ source: s.source, type, worst, n, skipped });
  });
  return out;
}
