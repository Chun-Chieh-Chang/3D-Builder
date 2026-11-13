import { readFileSync, writeFileSync } from 'node:fs';
import { Kernel } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';
const D = process.env.STEP_DIR!;
const circum = (a: number[], b: number[], c: number[]) => { const ab = Math.hypot(...a.map((x, i) => x - b[i]!)), bc = Math.hypot(...b.map((x, i) => x - c[i]!)), ca = Math.hypot(...c.map((x, i) => x - a[i]!)); const s = (ab + bc + ca) / 2; const A = Math.sqrt(Math.max(0, s * (s - ab) * (s - bc) * (s - ca))); return A > 1e-12 ? (ab * bc * ca) / (4 * A) : Infinity; };
export function measure(kernel: any, imp: { shape: number }, rel = '', part: any = null, forceR?: number) {
  const k = kernel as any; const oc = k.oc; const shape = k.get(imp.shape);
  const topo = kernel.topology(imp.shape); const V = kernel.massProps(imp.shape).volume;
  const smooth = kernel.smoothEdges(imp.shape, topo.edges.map((_, i) => i));
  const faces: any[] = []; for (const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
  const ANALYTIC = new Set(['plane', 'cylinder', 'cone', 'sphere', 'torus']);
  const out: any[] = []; let impact = 0, cands = 0;
  for (let fi = 0; fi < faces.length; fi++) {
    if (ANALYTIC.has(topo.faces[fi]!.surface) && !(forceR !== undefined && topo.faces[fi]!.surface === 'torus')) continue;
    const ad = new oc.BRepAdaptor_Surface(faces[fi], true);
    const u0 = ad.FirstUParameter(), u1 = ad.LastUParameter(), v0 = ad.FirstVParameter(), v1 = ad.LastVParameter();
    const P = (u: number, v: number) => { const p = ad.Value(u, v); return [p.X(), p.Y(), p.Z()]; };
    let r = NaN, dirn = '';
    for (const dd of ['v', 'u']) { const rs: number[] = []; for (let s = 0; s <= 8; s++) { const t = s / 8; const pts = [0, 0.37, 0.71, 1].map((w) => (dd === 'v' ? P(u0 + (u1 - u0) * t, v0 + (v1 - v0) * w) : P(u0 + (u1 - u0) * w, v0 + (v1 - v0) * t))); rs.push(circum(pts[0]!, pts[1]!, pts[2]!), circum(pts[1]!, pts[2]!, pts[3]!)); } const m = rs.reduce((a, b) => a + b, 0) / rs.length; if (Number.isFinite(m) && Math.max(...rs) - Math.min(...rs) < 1e-6 * Math.max(1, m)) { r = m; dirn = dd; break; } }
    let spread = 0;
    if (forceR !== undefined) { const rs: number[] = []; for (let q = 0; q <= 8; q++) { const t = q / 8; const pts = [0, 0.37, 0.71, 1].map((w) => P(u0 + (u1 - u0) * t, v0 + (v1 - v0) * w)); const pts2 = [0, 0.37, 0.71, 1].map((w) => P(u0 + (u1 - u0) * w, v0 + (v1 - v0) * t)); rs.push(Math.min(Math.abs(circum(pts[0]!, pts[1]!, pts[2]!) - forceR), Math.abs(circum(pts2[0]!, pts2[1]!, pts2[2]!) - forceR))); } spread = Math.max(...rs); r = forceR; }
    if (!Number.isFinite(r) || r > 5) { out.push({ face: fi, kind: 'not-round', area: topo.faces[fi]!.area }); continue; }
    cands++;
    // supports: neighbours across smooth edges that are not themselves this kind of round
    const nb = new Set<number>(); topo.edges.forEach((e, ei) => { if (smooth[ei] && e.faces.includes(fi)) for (const n of e.faces) if (n !== fi) nb.add(n); });
    const sup = [...nb];
    const surfs = sup.map((n) => oc.BRep_Tool.Surface(faces[n]));
    let worst = 0, worstPerSupport: number[] = sup.map(() => 0);
    for (let i = 1; i < 8; i++) for (let j = 1; j < 8; j++) {
      const u = u0 + ((u1 - u0) * i) / 8, v = v0 + ((v1 - v0) * j) / 8;
      { const cl = new oc.BRepClass_FaceClassifier(faces[fi], new oc.gp_Pnt2d(u, v), 1e-9); if (String(cl.State()) !== 'TopAbs_IN' && cl.State() !== oc.TopAbs_State.TopAbs_IN) continue; }
      const d1 = ad.EvalD1(u, v); const p = [d1.Point.X(), d1.Point.Y(), d1.Point.Z()];
      const du = [d1.D1U.X(), d1.D1U.Y(), d1.D1U.Z()], dv = [d1.D1V.X(), d1.D1V.Y(), d1.D1V.Z()];
      const n = [du[1]! * dv[2]! - du[2]! * dv[1]!, du[2]! * dv[0]! - du[0]! * dv[2]!, du[0]! * dv[1]! - du[1]! * dv[0]!]; const l = Math.hypot(...n); const nn = n.map((x) => x / l);
      let best = Infinity, bestPer: number[] = [];
      for (const sg of [1, -1]) {
        const c = p.map((x, q) => x + sg * r * nn[q]!);
        const per = surfs.map((S: any) => { const pr = new oc.GeomAPI_ProjectPointOnSurf(new oc.gp_Pnt(c[0], c[1], c[2]), S); return pr.NbPoints() > 0 ? Math.abs(pr.LowerDistance() - r) : Infinity; });
        // the ball touches the two supports it rolls on: the two nearest to r
        const two = [...per].sort((a, b) => a - b).slice(0, 2); const m = Math.max(...two);
        if (m < best) { best = m; bestPer = per; }
      }
      worst = Math.max(worst, best); worstPerSupport = worstPerSupport.map((w, q) => Math.max(w, bestPer[q] ?? 0));
    }
    const area = topo.faces[fi]!.area; impact += worst * area;
    out.push({ face: fi, r: +r.toFixed(6), dirn, spread, perSupport: worstPerSupport, supports: sup.map((n) => topo.faces[n]!.surface), area: +area.toFixed(4), worstDev: worst });
  }
  return { rel, part, V, faces: topo.faces.length, roundCandidates: cands, volumeImpactBound: impact / V, items: out };
}
