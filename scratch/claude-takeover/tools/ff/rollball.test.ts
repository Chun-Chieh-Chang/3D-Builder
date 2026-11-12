import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
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
it('rolling-ball deviation', async () => {
  const kernel = await Kernel.load();
  if (process.env.TARGET) {
    const [rel, part] = JSON.parse(process.env.TARGET!);
    let bytes = new Uint8Array(readFileSync(`${D}/${rel}`));
    if (part !== null) bytes = stepAssemblyPlan(kernel, bytes).prototypes.filter((p: any) => p.part)[part]!.part!.step;
    writeFileSync(process.env.OUT!, JSON.stringify(measure(kernel, kernel.importStep(bytes), rel, part), null, 1));
    return;
  }
  // synthetic: OCCT's own rounds on edges where they come out as B-splines
  const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as any;
  const sq = (w: number) => ({ outer: [[-w, -w], [w, -w], [w, w], [-w, w]].map((a, i, p) => ({ kind: 'line', a, b: p[(i + 1) % 4], source: 'b' + i })), holes: [] }) as any;
  const res: any = {};
  for (const [name, tilt, draft] of [['upright cylinder on plane (torus control)', 0, 0], ['drafted cylinder on plane, tilted', 0.25, 5]] as const) {
    const plate = kernel.extrude(XY, [sq(20)], [0, 0, 5]).shape;
    const frame = { origin: [0, 0, 5], xDir: [1, 0, 0], yDir: [0, Math.cos(tilt), Math.sin(tilt)], normal: [0, -Math.sin(tilt), Math.cos(tilt)] } as any;
    const boss = kernel.extrude({ ...frame, origin: [0, -2 * Math.sin(tilt), 5 - 2 * Math.cos(tilt)] }, [{ outer: [{ kind: 'circle', c: [0, 0], r: 6, source: 'c' }], holes: [] }], frame.normal.map((x: number) => x * 12), 0, undefined, (draft * Math.PI) / 180).shape;
    const s = kernel.boolean('fuse', plate, boss).shape;
    const t = kernel.topology(s);
    // the edge where the boss meets the top of the plate
    const top = t.faces.findIndex((f: any) => f.geometry?.type === 'plane' && Math.abs(f.geometry.normal[2] - 1) < 1e-9 && Math.abs(f.center[2] - 5) < 1e-6);
    const bossFace = t.faces.findIndex((f: any) => f.geometry?.type === 'cylinder' || f.geometry?.type === 'cone');
    const edges = t.edges.flatMap((e: any, i: number) => (e.faces.includes(top) && e.faces.some((n: number) => n !== top && (t.faces[n].geometry?.type === 'cylinder' || t.faces[n].geometry?.type === 'cone')) ? [i] : []));
    res[name + ' edges'] = edges.map((i: number) => t.edges[i].curve);
    for (const r of [1.5]) for (const ap of [1e-8]) for (const fs of ['ChFi3d_Rational']) {
      try { const t0 = performance.now(); const kk = kernel as any; const oc = kk.oc; const shp = kk.get(s); const mk = new oc.BRepFilletAPI_MakeFillet(shp, oc.ChFi3d_FilletShape[fs]); mk.SetParams(Number(process.env.TANG ?? 1e-2), ap, ap / 10, ap, ap / 10, ap / 10); const top0 = kernel.topology(s); for (const ei of edges) { const m = top0.edges[ei]!.mid; for (const ex = new oc.TopExp_Explorer(shp, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) { const ed = oc.TopoDS.Edge(ex.Current()); const ad = new oc.BRepAdaptor_Curve(ed); const pm = ad.Value((ad.FirstParameter() + ad.LastParameter()) / 2); if (Math.hypot(pm.X() - m[0], pm.Y() - m[1], pm.Z() - m[2]) < 1e-6) { mk.Add(r, ed); break; } } } mk.Build(); if (!mk.IsDone()) throw new Error('not done'); const f = { shape: kk.put(mk.Shape()) }; const ms = Math.round(performance.now() - t0); const m = measure(kernel, f, name, r, r); res[`${name} r=${r} ${fs}`] = { ms, impact: m.volumeImpactBound, rounds: m.items.filter((x: any) => x.r).map((x: any) => ({ r: x.r, dev: x.worstDev, spread: x.spread, sup: x.supports, per: x.perSupport, area: x.area })), other: m.items.filter((x: any) => !x.r).length }; }
      catch (e) { res[`${name} r=${r} ${fs}`] = String(e).slice(0, 150); }
    }
  }
  writeFileSync(process.env.OUT!, JSON.stringify(res, null, 1));
}, 600000);
