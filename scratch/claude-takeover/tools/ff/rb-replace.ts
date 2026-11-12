// C2.7c/d prototype: replace OCCT's round face (closed with a seam, or open with its ends on other faces) by the exact rolling ball.
import { exactRound, interpolate, supportOf, type Support, type V3, len, sub, dot, cross, unit, mul } from './rb-lib';

const pt = (p: any): V3 => [p.X(), p.Y(), p.Z()];

function knotsOf(oc: any, U: number[]) {
  const ku: number[] = [], mu: number[] = [];
  for (const u of U) { if (ku.length && Math.abs(ku[ku.length - 1]! - u) < 1e-15) mu[mu.length - 1]!++; else { ku.push(u); mu.push(1); } }
  const K = new oc.NCollection_Array1_double(1, ku.length), M = new oc.NCollection_Array1_int(1, mu.length);
  ku.forEach((u, i) => K.SetValue(i + 1, u)); mu.forEach((m, i) => M.SetValue(i + 1, m));
  return { K, M };
}
export function curve3(oc: any, s: number[], pts: V3[], P: number) {
  const { U, poles } = interpolate(s, pts, Math.min(P, s.length - 1));
  const a = new oc.NCollection_Array1_gp_Pnt(1, poles.length); poles.forEach((q, i) => a.SetValue(i + 1, new oc.gp_Pnt(q[0], q[1], q[2])));
  const { K, M } = knotsOf(oc, U); return new oc.Geom_BSplineCurve(a, K, M, Math.min(P, s.length - 1), false);
}
export function curve2(oc: any, s: number[], pts: number[][], P: number) {
  const { U, poles } = interpolate(s, pts, Math.min(P, s.length - 1));
  const a = new oc.NCollection_Array1_gp_Pnt2d(1, poles.length); poles.forEach((q, i) => a.SetValue(i + 1, new oc.gp_Pnt2d(q[0], q[1])));
  const { K, M } = knotsOf(oc, U); return new oc.Geom2d_BSplineCurve(a, K, M, Math.min(P, s.length - 1), false);
}

/** Signed distance of p from a face's surface (sign by the surface's own normal at the foot) and the foot's parameters. */
function signed(oc: any, face: any) {
  const S = oc.BRep_Tool.Surface(face); const ad = new oc.BRepAdaptor_Surface(face, false);
  return (p: V3) => {
    const pr = new oc.GeomAPI_ProjectPointOnSurf(new oc.gp_Pnt(p[0], p[1], p[2]), S); const uv = pr.LowerDistanceParameters(0, 0);
    const d = ad.EvalD1(uv.U, uv.V); const n = unit(cross(pt(d.D1U), pt(d.D1V)));
    return { d: dot(sub(p, pt(d.Point)), n), uv: [uv.U, uv.V] as [number, number] };
  };
}
/** A root of f near x0 (secant), f continuous. */
function root(f: (x: number) => number, x0: number, h: number) {
  let a = x0, b = x0 + h, fa = f(a), fb = f(b);
  for (let i = 0; i < 80 && Math.abs(fb) > 1e-15 && fb !== fa; i++) { const c = b - (fb * (b - a)) / (fb - fa); a = b; fa = fb; b = c; fb = f(b); }
  return b;
}

export const trace = { step: '' };
export interface ExactifyResult { shape: any; round: any; info: any }

/**
 * `shape`: the body OCCT rounded; `Fold`: its round face (as found in `shape`); `supFaces`: the two faces it rolls on (in `shape`); `sharp`: a
 * BRepAdaptor_Curve of the sharp edge before rounding; r: radius; sgn: +1 when the ball is on the side the supports' face normals point to.
 */
export function exactify(oc: any, shape: any, Fold: any, supFaces: any[], sharp: any, r: number, sgn: number, seamSwap = true, original?: any): ExactifyResult {
  const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE, EDGE = oc.TopAbs_ShapeEnum.TopAbs_EDGE, VERT = oc.TopAbs_ShapeEnum.TopAbs_VERTEX, WIRE = oc.TopAbs_ShapeEnum.TopAbs_WIRE;
  const FWD = oc.TopAbs_Orientation.TopAbs_FORWARD, REV = oc.TopAbs_Orientation.TopAbs_REVERSED;
  const list = (s: any, kind: any) => { const out: any[] = []; for (const ex = new oc.TopExp_Explorer(s, kind, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) out.push(ex.Current()); return out; };
  const uniq = (xs: any[]) => { const out: any[] = []; for (const x of xs) if (!out.some((y) => y.IsSame(x))) out.push(x); return out; };
  const faces = list(shape, FACE).map((x) => oc.TopoDS.Face(x));
  const info: any = {};
  let sup: Support[] = supFaces.map((f) => supportOf(oc, f)); let sF = [...supFaces];
  const Fedges = uniq(list(Fold, EDGE)).map((e) => oc.TopoDS.Edge(e.Oriented(FWD)));
  const samplesOn = (e: any) => { const c = new oc.BRepAdaptor_Curve(e); return [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => pt(c.Value(c.FirstParameter() + (c.LastParameter() - c.FirstParameter()) * f))); };
  const onSup = (e: any, k: number) => Math.max(...samplesOn(e).map((p) => sup[k]!.dist(p)));
  const kindOf = (e: any) => { if (oc.BRep_Tool.IsClosed(e, Fold)) return 'seam'; const lim = Math.max(1e-5, 10 * oc.BRep_Tool.Tolerance(e)); const d0 = onSup(e, 0), d1 = onSup(e, 1); return d0 < lim && d0 < d1 ? 'c0' : d1 < lim ? 'c1' : 'end'; };
  // the face across an end edge
  const across = (e: any) => faces.find((f) => !f.IsSame(Fold) && list(f, EDGE).some((x) => x.IsSame(e)));
  const closed = sharp.Value(sharp.FirstParameter()).Distance(sharp.Value(sharp.LastParameter())) < 1e-9;

  // orientation: the exact surface's own normal must agree with the round face's own normal
  const build = (tStart: number | undefined, pin: any, span?: [number, number]) => {
    // an open round is built past both ends of the sharp edge, and trimmed by the faces it ends on
    let ca = sharp;
    if (span) { const c = oc.BRep_Tool.Curve(sharpEdgeOf(sharp), 0, 0); ca = new oc.GeomAdaptor_Curve(c.returnValue ?? c, span[0], span[1]); }
    return exactRound(oc, sup[0]!, sup[1]!, ca, r, sgn, Number(process.env.NS ?? 200), 5, tStart, pin);
  };
  const sharpEdgeOf = (c: any) => c.Edge();
  let span: [number, number] | undefined;
  if (!closed) { const a = sharp.FirstParameter(), b = sharp.LastParameter(); const sp = len(pt(sharp.EvalD1((a + b) / 2).D1)); const d = (4 * r) / sp; span = [a - d, b + d]; }
trace.step = 'build';
  let ex = build(undefined, undefined, span);
  {
    const ad = new oc.BRepAdaptor_Surface(Fold, true); const um = (ad.FirstUParameter() + ad.LastUParameter()) / 2, vm = (ad.FirstVParameter() + ad.LastVParameter()) / 2;
    const d = ad.EvalD1(um, vm); const n0 = unit(cross(pt(d.D1U), pt(d.D1V)));
    const uv = new oc.GeomAPI_ProjectPointOnSurf(d.Point, ex.surf).LowerDistanceParameters(0, 0);
    const e1 = new oc.GeomAdaptor_Surface(ex.surf).EvalD1(uv.U, uv.V);
    if (dot(n0, unit(cross(pt(e1.D1U), pt(e1.D1V)))) < 0) { sup = [sup[1]!, sup[0]!]; sF = [sF[1], sF[0]]; ex = build(undefined, undefined, span); info.swapped = true; }
  }
trace.step = 'kinds';
  const kinds = Fedges.map(kindOf); info.kinds = kinds;
  if (closed) {
    const seam = Fedges[kinds.indexOf('seam')];
    if (!seam) throw new Error('closed round without a seam');
    // start at OCCT's seam, pinned to the seam of a periodic support so the vertex stays at its end
    const c = new oc.BRepAdaptor_Curve(seam); const q = pt(c.Value(c.FirstParameter()));
    const a = sharp.FirstParameter(), b = sharp.LastParameter(); let best = Infinity, bt = a; const N = 4000;
    for (let i = 0; i < N; i++) { const t2 = a + ((b - a) * i) / N; const d2 = len(sub(pt(sharp.Value(t2)), q)); if (d2 < best) { best = d2; bt = t2; } }
    let pin: any;
    for (const k of [0, 1]) { const adS = new oc.BRepAdaptor_Surface(sF[k], true); if (adS.IsUPeriodic()) pin = { index: k * 2, value: adS.FirstUParameter(), period: adS.UPeriod() }; }
    ex = build(bt, pin);
  }
trace.step = 'after-build';
  const L = ex.u1; const tol = 1e-7; const B = new oc.BRep_Builder(); const loc = new oc.TopLoc_Location();
  const S = new oc.GeomAdaptor_Surface(ex.surf);
  const Sv = (u: number, v: number): V3 => pt(S.Value(u, v));
  const iso = [ex.surf.VIso(0), ex.surf.VIso(1)];
  const uOnIso = (k: number, p: any) => new oc.GeomAPI_ProjectPointOnCurve(p, iso[k]).LowerDistanceParameter();
  const periodOf = (f: any) => { const a = new oc.BRepAdaptor_Surface(f, true); return [a.IsUPeriodic() ? a.UPeriod() : 0, a.IsVPeriodic() ? a.VPeriod() : 0] as [number, number]; };

  // the parameters on the contact curves where each old vertex goes
  const vNew = new Map<any, { p: V3 }>();
  const endU = (k: number, V: any, endFace: any) => { const sd = signed(oc, endFace); const u0 = uOnIso(k, oc.BRep_Tool.Pnt(V)); return root((u) => sd(Sv(u, k)).d, u0, 1e-4); };
  const vertexKey: { V: any; p: V3 }[] = [];
  const setV = (V: any, p: V3) => { const e = vertexKey.find((x) => x.V.IsSame(V)); if (e) { info.vertexDisagree = Math.max(info.vertexDisagree ?? 0, len(sub(e.p, p))); return; } vertexKey.push({ V, p }); };

  const newOf: any[] = [], flips: boolean[] = [];
  const FnewF = new oc.TopoDS_Face(); B.MakeFace(FnewF, ex.surf, loc, tol);
  // end faces of each contact end: the face across the end edge that shares the vertex
  const endEdges = Fedges.filter((_, i) => kinds[i] === 'end');
  const endFaceAt = (V: any) => { const e = endEdges.find((x) => list(x, VERT).some((w) => w.IsSame(V))); return e ? across(e) : null; };
  const contactRange: { k: number; ua: number; ub: number; Va: any; Vb: any }[] = [];
  Fedges.forEach((e, ei) => {
    const ca = new oc.BRepAdaptor_Curve(e); const a0 = ca.FirstParameter(), a1 = ca.LastParameter();
    const E2 = new oc.TopoDS_Edge();
    const vs = list(e, VERT); const Vf = oc.TopoDS.Vertex(vs.find((v) => v.Orientation() === FWD).Oriented(FWD)); const Vl = oc.TopoDS.Vertex(vs.find((v) => v.Orientation() === REV).Oriented(FWD));
trace.step = 'seam';
    if (kinds[ei] === 'seam') {
      const p0 = pt(ca.Value(a0)); flips[ei] = !(sup[0]!.dist(p0) < sup[1]!.dist(p0));
      B.MakeEdge(E2, ex.surf.UIso(0), tol);
      const [V0, V1] = flips[ei] ? [Vl, Vf] : [Vf, Vl];
      B.Add(E2, V0.Oriented(FWD)); B.Add(E2, V1.Oriented(REV)); B.Range(E2, 0, 1, false);
      const line = (u: number) => new oc.Geom2d_Line(new oc.gp_Pnt2d(u, 0), new oc.gp_Dir2d(0, 1));
      const [c1, c2] = seamSwap ? [line(L), line(0)] : [line(0), line(L)];
      B.UpdateEdge(E2, c1, c2, FnewF, tol);
      B.UpdateVertex(oc.TopoDS.Vertex(V0.Oriented(FWD)), 0, E2, tol); B.UpdateVertex(oc.TopoDS.Vertex(V1.Oriented(REV)), 1, E2, tol);
      setV(V0, Sv(0, 0)); setV(V1, Sv(0, 1));
    } else if (kinds[ei] === 'c0' || kinds[ei] === 'c1') {
trace.step = 'contact';
      const k = kinds[ei] === 'c0' ? 0 : 1;
      const d = ca.EvalD1((a0 + a1) / 2); const um = uOnIso(k, d.Point);
      flips[ei] = dot(pt(d.D1), pt(new oc.GeomAdaptor_Curve(iso[k]).EvalD1(um).D1)) < 0;
      let ua: number, ub: number, Va: any, Vb: any;
      if (closed) { ua = 0; ub = L; Va = Vb = Vf; }
      else {
        [Va, Vb] = flips[ei] ? [Vl, Vf] : [Vf, Vl];
        const fa = endFaceAt(Va), fb = endFaceAt(Vb); if (!fa || !fb) throw new Error('contact end without an end face');
trace.step = 'endU';
        ua = endU(k, Va, fa); ub = endU(k, Vb, fb);
        if (!(ub > ua)) throw new Error('contact runs backwards');
      }
trace.step = 'contactEdge';
      B.MakeEdge(E2, iso[k], tol);
      B.Add(E2, Va.Oriented(FWD)); B.Add(E2, Vb.Oriented(REV)); B.Range(E2, ua, ub, false);
      B.UpdateEdge(E2, new oc.Geom2d_Line(new oc.gp_Pnt2d(0, k), new oc.gp_Dir2d(1, 0)), FnewF, tol);
trace.step = 'contactPcurve';
      const G = sF[k]; const per = periodOf(G);
      const pc = ex.pcurve(k * 2, per);
      // the same turn of a periodic support as OCCT's pcurve
      { const o2 = new oc.BRepAdaptor_Curve2d(e, G); const ref = o2.Value(flips[ei] ? o2.LastParameter() : o2.FirstParameter()); const mine = pc.Value(ua); const dx = per[0] ? per[0] * Math.round((ref.X() - mine.X()) / per[0]) : 0, dy = per[1] ? per[1] * Math.round((ref.Y() - mine.Y()) / per[1]) : 0; if (dx || dy) pc.Translate(new oc.gp_Vec2d(dx, dy)); }
      B.UpdateEdge(E2, pc, G, tol);
      B.UpdateVertex(oc.TopoDS.Vertex(Va.Oriented(FWD)), ua, E2, tol); B.UpdateVertex(oc.TopoDS.Vertex(Vb.Oriented(REV)), ub, E2, tol);
      setV(Va, Sv(ua, k)); setV(Vb, Sv(ub, k));
      contactRange.push({ k, ua, ub, Va, Vb });
    }
    newOf[ei] = E2;
  });
  // end edges: where the round crosses the face it ends on, v from 0 to 1
  Fedges.forEach((e, ei) => {
    if (kinds[ei] !== 'end') return;
trace.step = 'endEdge';
    const G = across(e); const sd = signed(oc, G);
    const vs = list(e, VERT).map((v) => oc.TopoDS.Vertex(v.Oriented(FWD)));
    const at = (k: number) => contactRange.find((c) => c.k === k && vs.some((v) => v.IsSame(c.Va) || v.IsSame(c.Vb)))!;
    const c0 = at(0), c1 = at(1);
    const u0 = vs.some((v) => v.IsSame(c0.Va)) ? c0.ua : c0.ub, u1 = vs.some((v) => v.IsSame(c1.Va)) ? c1.ua : c1.ub;
    const V0 = vs.find((v) => v.IsSame(c0.Va) || v.IsSame(c0.Vb)), V1 = vs.find((v) => v.IsSame(c1.Va) || v.IsSame(c1.Vb));
    const N = 40; const vv: number[] = [], uu: number[] = [], P3: V3[] = [], P2: number[][] = [];
    let uPrev = u0;
    for (let j = 0; j <= N; j++) {
      const v = j / N; const u = j === 0 ? u0 : j === N ? u1 : root((x) => sd(Sv(x, v)).d, uPrev + (u1 - u0) / N, 1e-5);
      uPrev = u; vv.push(v); uu.push(u); const p = Sv(u, v); P3.push(p); P2.push(sd(p).uv);
    }
    const per = periodOf(G); for (let j = 1; j < P2.length; j++) for (const dd of [0, 1]) if (per[dd]) { while (P2[j]![dd]! - P2[j - 1]![dd]! > per[dd]! / 2) P2[j]![dd]! -= per[dd]!; while (P2[j]![dd]! - P2[j - 1]![dd]! < -per[dd]! / 2) P2[j]![dd]! += per[dd]!; }
    const E2 = new oc.TopoDS_Edge(); B.MakeEdge(E2, curve3(oc, vv, P3, 5), tol);
    const ca = new oc.BRepAdaptor_Curve(e); flips[ei] = !(sup[0]!.dist(pt(ca.Value(ca.FirstParameter()))) < sup[1]!.dist(pt(ca.Value(ca.FirstParameter()))));
    B.Add(E2, V0.Oriented(FWD)); B.Add(E2, V1.Oriented(REV)); B.Range(E2, 0, 1, false);
    B.UpdateEdge(E2, curve2(oc, vv, uu.map((u, j) => [u, vv[j]!]), 5), FnewF, tol);
    const pcG = curve2(oc, vv, P2, 5);
    { const o2 = new oc.BRepAdaptor_Curve2d(e, G); const ref = o2.Value(flips[ei] ? o2.LastParameter() : o2.FirstParameter()); const mine = pcG.Value(0); const dx = per[0] ? per[0] * Math.round((ref.X() - mine.X()) / per[0]) : 0, dy = per[1] ? per[1] * Math.round((ref.Y() - mine.Y()) / per[1]) : 0; if (dx || dy) pcG.Translate(new oc.gp_Vec2d(dx, dy)); }
    B.UpdateEdge(E2, pcG, G, tol);
    B.UpdateVertex(oc.TopoDS.Vertex(V0.Oriented(FWD)), 0, E2, tol); B.UpdateVertex(oc.TopoDS.Vertex(V1.Oriented(REV)), 1, E2, tol);
    newOf[ei] = E2;
  });
  // move the shared vertices, and every other edge ending at one: its parameter there and its range
trace.step = 'vertices';
  const seen: any[] = []; const extra: { old: any; neu: any; flip: boolean }[] = [];
  for (const { V, p } of vertexKey) {
    const before = oc.BRep_Tool.Pnt(V); (info.vertexMoved ??= []).push(+before.Distance(new oc.gp_Pnt(p[0], p[1], p[2])).toExponential(3));
    B.UpdateVertex(V, new oc.gp_Pnt(p[0], p[1], p[2]), tol);
  }
  for (const f of faces) for (const e of list(f, EDGE)) {
    const ed = oc.TopoDS.Edge(e.Oriented(FWD)); if (Fedges.some((x) => x.IsSame(ed)) || seen.some((x) => x.IsSame(ed))) continue; seen.push(ed);
    const vs = list(ed, VERT); const hit = vertexKey.filter((k) => vs.some((v) => v.IsSame(k.V))); if (!hit.length) continue;
    const c = new oc.BRepAdaptor_Curve(ed); let f0 = c.FirstParameter(), f1 = c.LastParameter();
    const C = oc.BRep_Tool.Curve(ed, 0, 0); const crv = C.returnValue ?? C;
    // a moved vertex past the end of this edge's curve (OCCT's round trimmed it): rebuild the edge on the curve and pcurves of the edge it came from in
    // the body before rounding, which run on past it, turned round when that edge runs the other way
    if (original) {
      const gcx = new oc.GeomAdaptor_Curve(crv);
      const past = !gcx.IsPeriodic() && hit.some((h) => { const pr = new oc.GeomAPI_ProjectPointOnCurve(new oc.gp_Pnt(h.p[0], h.p[1], h.p[2]), crv); if (pr.NbPoints() === 0) return true; const q = pr.LowerDistanceParameter(); return q <= gcx.FirstParameter() + 1e-12 || q >= gcx.LastParameter() - 1e-12 || pr.LowerDistance() > 1e-9; });
      const mid = gcx.Value((f0 + f1) / 2);
      // the edge that holds this one's middle: on its curve and within its range (several edges can share one curve)
      const oe = past ? list(original, EDGE).map((x: any) => oc.TopoDS.Edge(x.Oriented(FWD))).find((x: any) => { const ca2 = new oc.BRepAdaptor_Curve(x); const C2 = oc.BRep_Tool.Curve(x, 0, 0); const c2 = C2.returnValue ?? C2; const pr2 = new oc.GeomAPI_ProjectPointOnCurve(mid, c2); if (!(pr2.NbPoints() > 0 && pr2.LowerDistance() < 1e-7)) return false; let q = pr2.LowerDistanceParameter(); const a2 = ca2.FirstParameter(), b2 = ca2.LastParameter(); const g = new oc.GeomAdaptor_Curve(c2); if (g.IsPeriodic()) { const T = g.Period(); while (q < a2) q += T; while (q > b2 + 1e-12) q -= T; } return q >= a2 - 1e-9 && q <= b2 + 1e-9; }) : null;
      if (past && !oe) (info.extDebug ??= []).push(list(original, EDGE).map((x: any) => oc.TopoDS.Edge(x)).flatMap((x: any) => { const ca2 = new oc.BRepAdaptor_Curve(x); const C2 = oc.BRep_Tool.Curve(x, 0, 0); const c2 = C2.returnValue ?? C2; const pr2 = new oc.GeomAPI_ProjectPointOnCurve(mid, c2); if (!(pr2.NbPoints() > 0 && pr2.LowerDistance() < 1e-5)) return []; return [`${c2.DynamicType().Name()} d=${pr2.LowerDistance().toExponential(1)} q=${pr2.LowerDistanceParameter().toFixed(4)} rng=[${ca2.FirstParameter().toFixed(4)},${ca2.LastParameter().toFixed(4)}] mine=[${f0.toFixed(4)},${f1.toFixed(4)}]`]; }));
      // OCCT may also have run this edge on past where it ended before rounding (the face the round ends on grows to hold the round's end), so only the
      // curve of the edge is taken, not its range; pcurves are made anew, exact at their samples
      const oc2 = past ? list(original, EDGE).map((x: any) => { const C2 = oc.BRep_Tool.Curve(oc.TopoDS.Edge(x), 0, 0); return C2.returnValue ?? C2; }).find((c2: any) => { const pr2 = new oc.GeomAPI_ProjectPointOnCurve(mid, c2); return pr2.NbPoints() > 0 && pr2.LowerDistance() < 1e-7; }) : null;
      if (oc2) {
        const c2 = oc2; const g2 = new oc.GeomAdaptor_Curve(c2); const T = g2.IsPeriodic() ? g2.Period() : 0;
        const qm = new oc.GeomAPI_ProjectPointOnCurve(mid, c2).LowerDistanceParameter();
        const near = (q: number) => { if (T) { while (q < qm - T / 2) q += T; while (q > qm + T / 2) q -= T; } return q; };
        const proj = (p: any) => near(new oc.GeomAPI_ProjectPointOnCurve(p, c2).LowerDistanceParameter());
        const ends = vs.map((v: any) => { const k = hit.find((h) => h.V.IsSame(v)); const P = k ? new oc.gp_Pnt(k.p[0], k.p[1], k.p[2]) : oc.BRep_Tool.Pnt(oc.TopoDS.Vertex(v)); const par = proj(P); return { v: oc.TopoDS.Vertex(v.Oriented(FWD)), fwd: v.Orientation() === FWD, par, off: g2.Value(par).Distance(P) }; });
        const a = ends.find((x: any) => x.fwd)!, b = ends.find((x: any) => !x.fwd)!;
        const flip = a.par > b.par; const [s0, s1] = flip ? [b, a] : [a, b];
        if (!T && (s0.par < g2.FirstParameter() - 1e-12 || s1.par > g2.LastParameter() + 1e-12)) throw new Error('the curve does not reach the exact vertex');
        const NE = new oc.TopoDS_Edge(); const tl = tol; B.MakeEdge(NE, c2, tl);
        B.Add(NE, s0.v.Oriented(FWD)); B.Add(NE, s1.v.Oriented(REV)); B.Range(NE, s0.par, s1.par, false);
        for (const mf of faces.filter((x: any) => list(x, EDGE).some((y: any) => y.IsSame(ed)))) {
          if (oc.BRep_Tool.IsClosed(ed, mf)) throw new Error('extending a seam edge not handled');
          const Smf = oc.BRep_Tool.Surface(mf); const per = periodOf(mf);
          const N = 40; const ss: number[] = [], P2: number[][] = [];
          for (let j2 = 0; j2 <= N; j2++) { const q = s0.par + ((s1.par - s0.par) * j2) / N; const uv = new oc.GeomAPI_ProjectPointOnSurf(g2.Value(q), Smf).LowerDistanceParameters(0, 0); ss.push(q); P2.push([uv.U, uv.V]); }
          for (let j2 = 1; j2 < P2.length; j2++) for (const dd of [0, 1]) if (per[dd]) { while (P2[j2]![dd]! - P2[j2 - 1]![dd]! > per[dd]! / 2) P2[j2]![dd]! -= per[dd]!; while (P2[j2]![dd]! - P2[j2 - 1]![dd]! < -per[dd]! / 2) P2[j2]![dd]! += per[dd]!; }
          const pc = curve2(oc, ss, P2, 5);
          // the same turn of a periodic face as the old pcurve, compared at the end both share
          { const o2 = new oc.BRepAdaptor_Curve2d(ed, mf); const unmovedFwd = !hit.some((h) => h.V.IsSame(a.v)); const ref = unmovedFwd ? o2.Value(o2.FirstParameter()) : o2.Value(o2.LastParameter()); const mine = pc.Value(unmovedFwd ? a.par : b.par); const dx = per[0] ? per[0] * Math.round((ref.X() - mine.X()) / per[0]) : 0, dy = per[1] ? per[1] * Math.round((ref.Y() - mine.Y()) / per[1]) : 0; if (dx || dy) pc.Translate(new oc.gp_Vec2d(dx, dy)); }
          B.UpdateEdge(NE, pc, mf, tl);
        }
        B.UpdateVertex(oc.TopoDS.Vertex(s0.v.Oriented(FWD)), s0.par, NE, Math.max(tl, 1.5 * s0.off)); B.UpdateVertex(oc.TopoDS.Vertex(s1.v.Oriented(REV)), s1.par, NE, Math.max(tl, 1.5 * s1.off));
        extra.push({ old: ed, neu: NE, flip }); (info.extended ??= []).push({ flip, off: [+s0.off.toExponential(2), +s1.off.toExponential(2)], type: c2.DynamicType().Name() });
        continue;
      }
    }
    for (const v of vs) { const k = hit.find((h) => h.V.IsSame(v)); if (!k) continue;
      const P0 = new oc.gp_Pnt(k.p[0], k.p[1], k.p[2]); const pr = new oc.GeomAPI_ProjectPointOnCurve(P0, crv);
      let par: number;
      if (pr.NbPoints() > 0) par = pr.LowerDistanceParameter();
      else { const gc = new oc.GeomAdaptor_Curve(crv); par = gc.Value(f0).Distance(P0) < gc.Value(f1).Distance(P0) ? f0 : f1; par = root((x) => { const d = gc.EvalD1(x); return dot(sub(pt(d.Point), k.p), pt(d.D1)); }, par, 1e-6 * (f1 - f0)); (info.projFallback ??= []).push(oc.Standard_Type ? '' : 'nearest'); }
      let off = new oc.GeomAdaptor_Curve(crv).Value(par).Distance(new oc.gp_Pnt(k.p[0], k.p[1], k.p[2])); info.offOtherEdge = Math.max(info.offOtherEdge ?? 0, off);
      { const gc = new oc.GeomAdaptor_Curve(crv); const old = v.Orientation() === FWD ? f0 : f1; if (gc.IsPeriodic()) { const T = gc.Period(); par += T * Math.round((old - par) / T); } (info.rangeEdits ??= []).push([+(par - old).toExponential(2), gc.IsPeriodic()]); }
      // the curve was trimmed by OCCT's round and the exact vertex lies past its end: take the edge's curve (and pcurves) from the body before rounding
      { const gc = new oc.GeomAdaptor_Curve(crv); if (!gc.IsPeriodic() && false && (par < gc.FirstParameter() || par > gc.LastParameter())) {
          const mid = gc.Value((f0 + f1) / 2);
trace.step = 'ext:findEdge';
          const oe = list(original, EDGE).map((x: any) => oc.TopoDS.Edge(x.Oriented(FWD))).find((x: any) => { const C2 = oc.BRep_Tool.Curve(x, 0, 0); const c2 = C2.returnValue ?? C2; const pr2 = new oc.GeomAPI_ProjectPointOnCurve(mid, c2); return pr2.NbPoints() > 0 && pr2.LowerDistance() < 1e-7; });
          if (oe) {
            const C2 = oc.BRep_Tool.Curve(oe, 0, 0); const c2 = C2.returnValue ?? C2;
trace.step = 'ext:faces';
            const ofaces = list(original, FACE).map((x: any) => oc.TopoDS.Face(x)).filter((x: any) => list(x, EDGE).some((y: any) => y.IsSame(oe)));
            const myFaces = faces.filter((x: any) => list(x, EDGE).some((y: any) => y.IsSame(ed)));
            const oldEnds = [c.Value(f0), c.Value(f1)];
trace.step = 'ext:curve';
            let c2b = c2; for (let q = 0; q < 3 && c2b.DynamicType().Name() === 'Geom_TrimmedCurve'; q++) c2b = c2b.BasisCurve(); B.UpdateEdge(ed, c2b, tol); (info.curveTypes ??= []).push(c2b.DynamicType().Name());
            for (const mf of myFaces) {
              const Smf = oc.BRep_Tool.Surface(mf); const smp = new oc.GeomAdaptor_Surface(Smf);
              const of = ofaces.find((x: any) => { const ad2 = new oc.BRepAdaptor_Surface(x, false); const q = ad2.Value((ad2.FirstUParameter() + ad2.LastUParameter()) / 2, (ad2.FirstVParameter() + ad2.LastVParameter()) / 2); const pr3 = new oc.GeomAPI_ProjectPointOnSurf(q, Smf); return pr3.NbPoints() > 0 && pr3.LowerDistance() < 1e-9; });
              if (!of) throw new Error('no original face for an extended edge');
trace.step = 'ext:closed';
              if (oc.BRep_Tool.IsClosed(oe, of)) throw new Error('extending a seam edge not handled');
trace.step = 'ext:pcurve';
              let pcc = new oc.BRepAdaptor_Curve2d(oe, of).Curve(); for (let q = 0; q < 3 && pcc.DynamicType().Name() === 'Geom2d_TrimmedCurve'; q++) pcc = oc.Handle_Geom2d_TrimmedCurve ? pcc.BasisCurve() : pcc.BasisCurve(); (info.pcurveTypes ??= []).push(pcc.DynamicType().Name());
trace.step = 'ext:updpc';
              B.UpdateEdge(ed, pcc, mf, tol);
            }
trace.step = 'ext:range';
            const prj = (q: any) => new oc.GeomAPI_ProjectPointOnCurve(q, c2).LowerDistanceParameter();
            const n0 = prj(oldEnds[0]), n1 = prj(oldEnds[1]); f0 = n0; f1 = n1;
            par = new oc.GeomAPI_ProjectPointOnCurve(P0, c2).LowerDistanceParameter();
            off = new oc.GeomAdaptor_Curve(c2).Value(par).Distance(P0); (info.extended ??= []).push(+off.toExponential(2));
            B.Range(ed, f0, f1, false);
            (info.extRange ??= []).push([+f0.toFixed(6), +f1.toFixed(6), ...myFaces.map((mf: any) => { try { const a2 = new oc.BRepAdaptor_Curve2d(ed, mf); const cc = a2.Curve(); return cc.DynamicType().Name() + `[${cc.FirstParameter().toFixed(4)},${cc.LastParameter().toFixed(4)}]`; } catch { return 'no pcurve on ' + new oc.BRepAdaptor_Surface(mf, false).GetType(); } })]);
          }
        } }
      { const C3 = oc.BRep_Tool.Curve(ed, 0, 0); const crv3 = C3.returnValue ?? C3; const gc = new oc.GeomAdaptor_Curve(crv3); if (!gc.IsPeriodic()) { const d0 = gc.FirstParameter(), d1 = gc.LastParameter(); if (par < d0 || par > d1) { const cl = Math.min(d1, Math.max(d0, par)); const gap = gc.Value(cl).Distance(P0); (info.clamped ??= []).push(+gap.toExponential(2)); par = cl; off = Math.max(off, gap); } } }
      // an edge of the body that is itself an approximation (an intersection curve) passes the exact point only within its own tolerance: the vertex takes that much
      const vt = Math.max(tol, 1.5 * off, oc.BRep_Tool.Tolerance(ed)); if (vt > tol) { B.UpdateVertex(oc.TopoDS.Vertex(v), vt); (info.vertexTol ??= []).push(+vt.toExponential(2)); }
      if (v.Orientation() === FWD) f0 = par; else f1 = par; B.UpdateVertex(oc.TopoDS.Vertex(v), par, ed, Math.max(tol, 1.5 * off)); }
    B.Range(ed, f0, f1, false);
  }
  // the round's wires, from its own (unoriented) face
  for (const w of list(Fold.Oriented(FWD), WIRE)) {
    const W = new oc.TopoDS_Wire(); B.MakeWire(W);
    for (const e of list(w.Oriented(FWD), EDGE)) { const i = Fedges.findIndex((x) => x.IsSame(e)); B.Add(W, newOf[i].Oriented(flips[i] ? (e.Orientation() === FWD ? REV : FWD) : e.Orientation())); }
    B.Add(FnewF, W.Oriented(w.Orientation()));
  }
  const Fnew = FnewF.Oriented(Fold.Orientation());
trace.step = 'shell';
  const shell = new oc.TopoDS_Shell(); B.MakeShell(shell);
  for (const f of faces) {
    if (f.IsSame(Fold)) { B.Add(shell, Fnew); continue; }
    if (!list(f, EDGE).some((e) => Fedges.some((x) => x.IsSame(e)) || extra.some((x) => x.old.IsSame(e)))) { B.Add(shell, f); continue; }
    const G2 = new oc.TopoDS_Face(); B.MakeFace(G2, oc.BRep_Tool.Surface(f), f.Location(), oc.BRep_Tool.Tolerance(f));
    for (const w of list(f.Oriented(FWD), WIRE)) {
      const W = new oc.TopoDS_Wire(); B.MakeWire(W);
      for (const e of list(w.Oriented(FWD), EDGE)) { const i = Fedges.findIndex((x) => x.IsSame(e)); const x2 = extra.find((x) => x.old.IsSame(e)); const rv = (o: any) => (o === FWD ? REV : FWD); B.Add(W, i >= 0 ? newOf[i].Oriented(flips[i] ? rv(e.Orientation()) : e.Orientation()) : x2 ? x2.neu.Oriented(x2.flip ? rv(e.Orientation()) : e.Orientation()) : e); }
      B.Add(G2, W.Oriented(w.Orientation()));
    }
    B.Add(shell, G2.Oriented(f.Orientation()));
  }
  const solid = new oc.TopoDS_Solid(); B.MakeSolid(solid); B.Add(solid, shell);
  info.residual = ex.residual; info.closed = closed;
  return { shape: solid, round: FnewF, info: { ...info, sup } };
}
