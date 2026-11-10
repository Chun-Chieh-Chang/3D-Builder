/**
 * Exact constant-radius rounds (C2, freeform-generalization.md §6b): OCCT's round of an edge between two faces is a B-spline that is not the rolling ball
 * when the edge is not a line or a circle (on a drafted wall, a cone, a tilted face): 2e-5 to 2e-3 mm off it. Here the ball's path is solved exactly —
 * per section of the sharp edge, Newton on the two supports' parameters so that p1 + r·n1 = p2 + r·n2 with the center in the edge's normal plane — and
 * the round is the surface of the ball's characteristic arcs (exactly circular across, interpolated along at degree 5: 1e-12 mm on the measured
 * cases). The faces OCCT made keep their topology; their surfaces, the contact and end edges and the shared vertices are replaced.
 */
// Geometry here goes through the OCCT bindings untyped, as the scratch prototype did; every result is checked (BRepCheck, volume) by the caller.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Arena } from './occt';

/** The most and the fewest sections of the ball taken along an edge, and how close to the ball the surface through them must be (mm). */
const ROUND_SECTIONS = 512;
const ROUND_SECTIONS_MIN = 32;
const ROUND_ACCURACY = 1e-10;
/** When the work on one round has to stop (performance.now()); past it a round keeps OCCT's surface. Set by the caller per round. */
let deadline = Infinity;
export function setRoundDeadline(at: number): void { deadline = at; }
const inTime = () => { if (performance.now() > deadline) throw new Error('exact round: out of time'); };

export type V3 = [number, number, number];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => mul(a, 1 / len(a));

export function solve(A: number[][], B: number[][]): number[][] {
  const n = A.length; const m = B[0]!.length;
  const a = A.map((r) => [...r]); const b = B.map((r) => [...r]);
  for (let k = 0; k < n; k++) {
    let p = k; for (let i = k + 1; i < n; i++) if (Math.abs(a[i]![k]!) > Math.abs(a[p]![k]!)) p = i;
    [a[k], a[p]] = [a[p]!, a[k]!]; [b[k], b[p]] = [b[p]!, b[k]!];
    for (let i = k + 1; i < n; i++) { const f = a[i]![k]! / a[k]![k]!; if (f === 0) continue; for (let j = k; j < n; j++) a[i]![j]! -= f * a[k]![j]!; for (let j = 0; j < m; j++) b[i]![j]! -= f * b[k]![j]!; }
  }
  for (let k = n - 1; k >= 0; k--) for (let j = 0; j < m; j++) { let s = b[k]![j]!; for (let i = k + 1; i < n; i++) s -= a[k]![i]! * b[i]![j]!; b[k]![j] = s / a[k]![k]!; }
  return b;
}
export function basis(U: number[], p: number, u: number): number[] {
  const n = U.length - p - 1; const N = new Array(U.length - 1).fill(0);
  for (let i = 0; i < U.length - 1; i++) N[i] = (u >= U[i]! && u < U[i + 1]!) || (u === U[U.length - 1] && i === n - 1 && U[i]! < U[i + 1]!) ? 1 : 0;
  for (let k = 1; k <= p; k++) for (let i = 0; i < U.length - 1 - k; i++) {
    const l = U[i + k]! - U[i]! > 0 ? ((u - U[i]!) / (U[i + k]! - U[i]!)) * N[i]! : 0;
    const r = U[i + k + 1]! - U[i + 1]! > 0 ? ((U[i + k + 1]! - u) / (U[i + k + 1]! - U[i + 1]!)) * N[i + 1]! : 0;
    N[i] = l + r;
  }
  return N.slice(0, n);
}
export function interpolate(s: number[], rows: number[][], p: number) {
  const n = s.length; const U: number[] = [];
  for (let i = 0; i <= p; i++) U.push(s[0]!);
  for (let j = 1; j < n - p; j++) { let a = 0; for (let i = j; i < j + p; i++) a += s[i]!; U.push(a / p); }
  for (let i = 0; i <= p; i++) U.push(s[n - 1]!);
  return { U, poles: solve(s.map((u) => basis(U, p, u)), rows) };
}

export interface Support {
  ev(u: number, v: number): { p: V3; n: V3; du: V3; dv: V3 };
  proj(q: V3): [number, number];
  dist(q: V3): number;
  /** distance from q to the surface, by Newton from the parameters `guess` (no global search: for points known to be near that foot) */
  foot(q: V3, guess: [number, number]): number;
  period: [number, number];
  /** frees what the support holds in the module (its projector) */
  release(): void;
}

/**
 * Projection of points onto one surface by one GeomAPI_ProjectPointOnSurf, set up once and asked again and again: made anew for each point on a B-spline of
 * many poles (an exact round, OCCT's own), each one keeps about 16 MB of the heap for good (measured, 180 poles: 100 projections +1.6 GB; one projector
 * asked 100 times, +0). `release` frees it.
 */
export function projector(oc: any, S: any) {
  let pr: any = null;
  const init = () => { pr = new oc.GeomAPI_ProjectPointOnSurf(); const b = S.Bounds(0, 0, 0, 0); pr.Init(S, b.U1, b.U2, b.V1, b.V2, oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad); };
  const run = (q: V3) => { if (!pr) init(); const g = new oc.gp_Pnt(q[0], q[1], q[2]); pr.Perform(g); g.delete(); if (pr.NbPoints() === 0) return null; const uv = pr.LowerDistanceParameters(0, 0); return { uv: [uv.U, uv.V] as [number, number], d: pr.LowerDistance() }; };
  return { run, release: () => { if (pr) { pr.delete(); pr = null; } } };
}

// The bindings' objects are not garbage collected: everything made in a loop here is deleted as soon as it is read, or a round over a B-spline loft
// runs the module out of memory (seen: 3.5 GB).
const xyz = (p: any): V3 => [p.X(), p.Y(), p.Z()];
/** read a point or vector the bindings handed back, and free it */
const take = (p: any): V3 => { const o = xyz(p); p.delete(); return o; };
/**
 * Derivatives written into outputs made once per module and reused (C2.14d). EvalD1/EvalD2 hand back a struct that Embind allocates and that stays in
 * the heap even when its points and vectors are deleted (measured on a cone, 2e6 calls: EvalD1 128 → 184 MiB; D1 into reused outputs 128 → 128).
 * Every value is copied out before returning, so nested calls do not clobber each other.
 */
const outputs = new WeakMap<object, any[]>();
const outs = (oc: any): any[] => {
  let o = outputs.get(oc);
  if (!o) { o = [new oc.gp_Pnt(), new oc.gp_Vec(), new oc.gp_Vec(), new oc.gp_Vec(), new oc.gp_Vec(), new oc.gp_Vec()]; outputs.set(oc, o); }
  return o;
};
/** point and first derivatives of a surface adaptor at (u, v) */
export function sD1(oc: any, ad: any, u: number, v: number) { const [P, U, V] = outs(oc); ad.D1(u, v, P, U, V); return { p: xyz(P), du: xyz(U), dv: xyz(V) }; }
/** point, first and second derivatives of a surface adaptor at (u, v) */
export function sD2(oc: any, ad: any, u: number, v: number) {
  const [P, U, V, UU, VV, UV] = outs(oc); ad.D2(u, v, P, U, V, UU, VV, UV);
  return { p: xyz(P), u: xyz(U), v: xyz(V), uu: xyz(UU), vv: xyz(VV), uv: xyz(UV) };
}
/** point and tangent of a curve adaptor (or of a `chainCurve`) at t */
export function cD1(oc: any, c: any, t: number): { p: V3; d: V3 } { if (c.composite) return c.d1(t); const [P, D] = outs(oc); c.D1(t, P, D); return { p: xyz(P), d: xyz(D) }; }
/** point, first and second derivatives of a curve adaptor at t */
export function cD2(oc: any, c: any, t: number) { const [P, D, DD] = outs(oc); c.D2(t, P, D, DD); return { p: xyz(P), d: xyz(D), dd: xyz(DD) }; }
export function supportOf(oc: any, face: any): Support {
  const arena = new Arena();
  const ad = arena.own(new oc.BRepAdaptor_Surface(face, true));
  const S = arena.own(oc.BRep_Tool.Surface(face));
  const flip = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1;
  // Newton evaluates each support repeatedly. D1 writes into reusable outputs and avoids the measured heap growth from EvalD1's Embind return values.
  const point = arena.own(new oc.gp_Pnt());
  const tangentU = arena.own(new oc.gp_Vec());
  const tangentV = arena.own(new oc.gp_Vec());
  const ev = (u: number, v: number) => {
    ad.D1(u, v, point, tangentU, tangentV);
    const p = xyz(point), du = xyz(tangentU), dv = xyz(tangentV);
    return { p, n: mul(unit(cross(du, dv)), flip), du, dv };
  };
  const P = projector(oc, S);
  const proj = (q: V3) => { const o = P.run(q); if (!o) throw new Error('no projection onto a support'); return o.uv; };
  const dist = (q: V3) => { const o = P.run(q); return o ? o.d : Infinity; };
  const foot = (q: V3, guess: [number, number]) => {
    let [a, b] = guess;
    for (let it = 0; it < 12; it++) {
      const e = ev(a, b); const w = sub(e.p, q); const F = [dot(w, e.du), dot(w, e.dv)];
      if (Math.abs(F[0]!) + Math.abs(F[1]!) < 1e-15) break;
      const h = 1e-7; const ea = ev(a + h, b), eb = ev(a, b + h);
      const Fa = [dot(sub(ea.p, q), ea.du), dot(sub(ea.p, q), ea.dv)], Fb = [dot(sub(eb.p, q), eb.du), dot(sub(eb.p, q), eb.dv)];
      const J = [[(Fa[0]! - F[0]!) / h, (Fb[0]! - F[0]!) / h], [(Fa[1]! - F[1]!) / h, (Fb[1]! - F[1]!) / h]];
      const det = J[0]![0]! * J[1]![1]! - J[0]![1]! * J[1]![0]!; if (!(Math.abs(det) > 0)) break;
      a -= (F[0]! * J[1]![1]! - F[1]! * J[0]![1]!) / det; b -= (J[0]![0]! * F[1]! - J[1]![0]! * F[0]!) / det;
    }
    return len(sub(ev(a, b).p, q));
  };
  const period: [number, number] = [ad.IsUPeriodic() ? ad.UPeriod() : 0, ad.IsVPeriodic() ? ad.VPeriod() : 0];
  return { ev, proj, dist, foot, period, release: () => {
    try { P.release(); } finally { arena.dispose(); }
  } };
}

/**
 * The ball of radius r touching supports a and b with its center in the normal plane of `ca` at t: Newton on both supports' parameters (x = ua, va, ub, vb).
 * `f` is the residual, `c` the center, `p1`/`p2` the contact points.
 */
export function ballSections(oc: any, a: Support, b: Support, ca: any, r: number, sgn: number) {
  const E = (tt: number) => cD1(oc, ca, tt);
  const F = (x: number[], tt: number) => {
    const A = a.ev(x[0]!, x[1]!), B = b.ev(x[2]!, x[3]!);
    const c1 = add(A.p, mul(A.n, sgn * r)), c2 = add(B.p, mul(B.n, sgn * r));
    const e = E(tt); const mid = mul(add(c1, c2), 0.5);
    return { f: [c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2], dot(sub(mid, e.p), e.d) / len(e.d)], c: mid, p1: A.p, p2: B.p };
  };
  const sectionAt = (tt: number, guess?: number[]) => {
    let x: number[];
    if (guess) x = [...guess];
    else {
      const e = E(tt).p; const n1 = a.ev(...a.proj(e)).n, n2 = b.ev(...b.proj(e)).n;
      const cg = add(e, mul(add(n1, n2), (sgn * r) / (1 + dot(n1, n2))));
      x = [...a.proj(cg), ...b.proj(cg)];
    }
    let out = F(x, tt);
    // Newton with the Jacobian kept while it still halves the residual each step (the guess is the last section's, so it nearly always does)
    let J: number[][] | null = null; let lastNf = Infinity;
    for (let it = 0; it < 30; it++) {
      const nf = Math.hypot(...out.f); if (nf < 1e-14) break;
      if (!J || nf > 0.5 * lastNf) { const h = 1e-7; J = [[], [], [], []]; for (let j = 0; j < 4; j++) { const xp = [...x]; xp[j]! += h; const xm = [...x]; xm[j]! -= h; const fp = F(xp, tt).f, fm = F(xm, tt).f; for (let q = 0; q < 4; q++) J[q]![j] = (fp[q]! - fm[q]!) / (2 * h); } }
      lastNf = nf;
      const dx = solve(J, out.f.map((v) => [v])).map((v) => v[0]!);
      let lam = 1; let nx = x.map((v, q) => v - lam * dx[q]!); let no = F(nx, tt);
      while (Math.hypot(...no.f) > nf && lam > 1e-4) { lam /= 2; nx = x.map((v, q) => v - lam * dx[q]!); no = F(nx, tt); }
      x = nx; out = no;
    }
    return { x, out };
  };
  return sectionAt;
}

/**
 * The exact round of radius r along the sharp edge E (a BRepAdaptor_Curve) between supports a (v = 0) and b (v = 1); sgn +1 when the ball is on the
 * side the supports' normals point to. Returns the OCCT surface and its u range (chord length of the center curve).
 */
export function exactRound(oc: any, a: Support, b: Support, ca: any, r: number, sgn: number, NS = ROUND_SECTIONS, P = 5, tStart?: number, pin?: { index: number; value: number; period: number }) {
  const tf = ca.FirstParameter(), t1f = ca.LastParameter(); let t0 = tStart ?? tf, t1 = t0 + (t1f - tf); let pinned: number | null = null;
  const sectionAt = ballSections(oc, a, b, ca, r, sgn);
  // optional: move the start so that one support parameter takes a given value (a vertex of that support's own seam)
  if (pin) {
    const per = pin.period; const wrap = (d: number) => (per > 0 ? d - per * Math.round(d / per) : d);
    const g = (tt: number) => wrap(sectionAt(tt).x[pin.index]! - pin.value);
    let ta = t0, tb = t0 + (t1 - t0) * 1e-3, ga = g(ta), gb = g(tb);
    for (let it = 0; it < 60 && Math.abs(gb) > 1e-15; it++) { const tn = tb - (gb * (tb - ta)) / (gb - ga); ta = tb; ga = gb; tb = tn; gb = g(tb); }
    pinned = tb;
  }
  const samples: { c: V3; p1: V3; p2: V3; x: number[] }[] = [];
  if (pinned !== null) { t0 = pinned; t1 = t0 + (t1f - tf); }
  let residual = 0; let prev: number[] | null = null;
  for (let i = 0; i <= NS; i++) {
    inTime();
    const tt = t0 + ((t1 - t0) * i) / NS;
    const { x, out } = sectionAt(tt, prev ?? undefined);
    residual = Math.max(residual, Math.hypot(...out.f)); prev = x;
    samples.push({ c: out.c, p1: out.p1, p2: out.p2, x });
  }
  const sp = [0]; for (let i = 1; i < samples.length; i++) sp.push(sp[i - 1]! + len(sub(samples[i]!.c, samples[i - 1]!.c)));
  const rows = samples.map(({ c, p1, p2 }) => {
    const A = sub(p1, c), B = sub(p2, c); const th = Math.acos(Math.max(-1, Math.min(1, dot(A, B) / (len(A) * len(B)))));
    const w = Math.cos(th / 2); const M = add(c, mul(unit(add(unit(A), unit(B))), r / w));
    return [...p1, ...mul(M, w), w, ...p2];
  });
  const { U, poles } = interpolate(sp, rows, P);
  const nu = poles.length;
  const arr = new oc.NCollection_Array2_gp_Pnt(1, nu, 1, 3); const wts = new oc.NCollection_Array2_double(1, nu, 1, 3);
  poles.forEach((row, i) => { const w = row[6]!; arr.SetValue(i + 1, 1, new oc.gp_Pnt(row[0], row[1], row[2])); arr.SetValue(i + 1, 2, new oc.gp_Pnt(row[3]! / w, row[4]! / w, row[5]! / w)); arr.SetValue(i + 1, 3, new oc.gp_Pnt(row[7], row[8], row[9])); wts.SetValue(i + 1, 1, 1); wts.SetValue(i + 1, 2, w); wts.SetValue(i + 1, 3, 1); });
  const ku: number[] = [], mu: number[] = []; for (const u of U) { if (ku.length && Math.abs(ku[ku.length - 1]! - u) < 1e-15) mu[mu.length - 1]!++; else { ku.push(u); mu.push(1); } }
  const UK = new oc.NCollection_Array1_double(1, ku.length), UM = new oc.NCollection_Array1_int(1, mu.length); ku.forEach((u, i) => UK.SetValue(i + 1, u)); mu.forEach((m, i) => UM.SetValue(i + 1, m));
  const VK = new oc.NCollection_Array1_double(1, 2), VM = new oc.NCollection_Array1_int(1, 2); VK.SetValue(1, 0); VK.SetValue(2, 1); VM.SetValue(1, 3); VM.SetValue(2, 3);
  const surf = new oc.Geom_BSplineSurface(arr, wts, UK, VK, UM, VM, P, 2, false, false);
  // the contact curves in each support's parameters, interpolated at the same parameters as the surface (exact at the samples)
  const pcurve = (k0: number, period: [number, number], start?: [number, number]) => {
    const pts = samples.map((q) => [q.x[k0]!, q.x[k0 + 1]!]);
    for (let i = 1; i < pts.length; i++) for (const d of [0, 1]) { const per = period[d]!; if (per > 0) { while (pts[i]![d]! - pts[i - 1]![d]! > per / 2) pts[i]![d]! -= per; while (pts[i]![d]! - pts[i - 1]![d]! < -per / 2) pts[i]![d]! += per; } }
    if (start) for (const d of [0, 1]) { const per = period[d]!; if (per > 0) { const k2 = Math.round((start[d]! - pts[0]![d]!) / per); for (const q of pts) q[d]! += k2 * per; } }
    const { poles: P2 } = interpolate(sp, pts, P);
    const arr2 = new oc.NCollection_Array1_gp_Pnt2d(1, P2.length); P2.forEach((q, i) => arr2.SetValue(i + 1, new oc.gp_Pnt2d(q[0], q[1])));
    return new oc.Geom2d_BSplineCurve(arr2, UK, UM, P, false);
  };
  // how far the surface is from the ball between the sections it went through: at the middle of each stretch, the center the surface implies
  // (a point of it, one radius along its normal) against both supports, feet found by Newton from the contact curves' own parameters
  const accuracy = (n: number) => {
    const ga = new oc.GeomAdaptor_Surface(surf); const pa = pcurve(0, a.period), pb = pcurve(2, b.period);
    const uv = (pc: any, u: number): [number, number] => { const q = pc.Value(u); const o: [number, number] = [q.X(), q.Y()]; q.delete(); return o; };
    let dev = 0;
    try {
      for (let i = 0; i < n; i++) {
        const u = sp[0]! + ((sp[sp.length - 1]! - sp[0]!) * (i + 0.5)) / n; const ga0 = uv(pa, u), gb0 = uv(pb, u);
        for (const v of [0.31, 0.5, 0.69]) {
          const d = sD1(oc, ga, u, v); const q = d.p; const nn = unit(cross(d.du, d.dv));
          let best = Infinity; for (const sg of [1, -1]) { const c = add(q, mul(nn, sg * r)); best = Math.min(best, Math.max(Math.abs(a.foot(c, ga0) - r), Math.abs(b.foot(c, gb0) - r))); }
          dev = Math.max(dev, best);
        }
      }
    } finally { ga.delete(); pa.delete(); pb.delete(); }
    return dev;
  };
  return { surf, pcurve, accuracy, t0, u0: sp[0]!, u1: sp[sp.length - 1]!, residual, closed: len(sub(samples[0]!.c, samples[samples.length - 1]!.c)) < 1e-9 };
}

/** Largest rolling-ball deviation of a face (sampled inside its parameter box) from radius r on the given supports. */
export function deviation(oc: any, face: any, sup: Support[], r: number, n = 40) {
  const ad = new oc.BRepAdaptor_Surface(face, true);
  const u0 = ad.FirstUParameter(), u1 = ad.LastUParameter(), v0 = ad.FirstVParameter(), v1 = ad.LastVParameter();
  let dev = 0;
  try {
    for (let i = 0; i <= n; i++) for (let j = 1; j < 8; j++) {
      const d = sD1(oc, ad, u0 + ((u1 - u0) * i) / n, v0 + ((v1 - v0) * j) / 8); const p = d.p;
      const nn = unit(cross(d.du, d.dv));
      let best = Infinity; for (const sg of [1, -1]) { const c = add(p, mul(nn, sg * r)); best = Math.min(best, Math.max(...sup.map((S) => Math.abs(S.dist(c) - r)))); }
      dev = Math.max(dev, best);
    }
  } finally { ad.delete(); }
  return dev;
}

// C2.7c/d prototype: replace OCCT's round face (closed with a seam, or open with its ends on other faces) by the exact rolling ball.

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

/**
 * Signed distance of p from a face's surface (sign by the surface's own normal at the foot) and the foot's parameters. The foot is refined by Newton from the last one (a global projection only to start, or when Newton leaves the surface's box): along a
 * cut, consecutive points are close, and a global projection on a B-spline of many patches is both slow and only good to its own tolerance (about 1e-9
 * in its parameters), which shows up as noise in an interpolated pcurve.
 */
function signedNear(oc: any, face: any, keep: { release(): void }[]) {
  const S = oc.BRep_Tool.Surface(face); const ad = new oc.BRepAdaptor_Surface(face, false); const PJ = projector(oc, S); keep.push(PJ);
  const U0 = ad.FirstUParameter(), U1 = ad.LastUParameter(), V0 = ad.FirstVParameter(), V1 = ad.LastVParameter(); const du0 = U1 - U0, dv0 = V1 - V0;
  const D2 = (u: number, v: number) => sD2(oc, ad, u, v);
  let last: [number, number] | null = null;
  // a start with none given: on a bounded surface (a B-spline: a round, OCCT's or exact) the nearest of a grid over the whole surface, with no GeomAPI projection
  // (each keeps heap, see `projector`); on an analytic surface (no such cost) the projection
  const bounded = [U0, U1, V0, V1].every((x) => Math.abs(x) < 1e50);
  const global = (p: V3): [number, number] => {
    if (bounded) { const a0 = U0, a1 = U1, b0 = V0, b1 = V1; let best = Infinity, uv: [number, number] = [a0, b0]; for (let i = 0; i <= 48; i++) for (let j = 0; j <= 48; j++) { const u = a0 + ((a1 - a0) * i) / 48, v = b0 + ((b1 - b0) * j) / 48; const d = len(sub(take(ad.Value(u, v)), p)); if (d < best) { best = d; uv = [u, v]; } } return uv; }
    const o = PJ.run(p); if (!o) throw new Error('no projection'); return o.uv;
  };
  const fn = (p: V3) => {
    let [u, v] = last ?? global(p); let ok = false;
    // Newton on the foot, damped: a step is taken only as far as it brings the surface nearer (far from the foot, or past the patch's end, a full step
    // can run off along the surface's extension)
    let e = D2(u, v); let w = sub(e.p, p); let dd = dot(w, w);
    // a foot when what is left of p − S(u, v) along the surface is nothing (to 1e-11 mm)
    const along = () => Math.abs(dot(w, e.u)) / len(e.u) + Math.abs(dot(w, e.v)) / len(e.v);
    for (let it = 0; it < 40; it++) {
      if (along() < 1e-11) { ok = true; break; }
      const F = [dot(w, e.u), dot(w, e.v)];
      const J = [[dot(e.u, e.u) + dot(w, e.uu), dot(e.u, e.v) + dot(w, e.uv)], [dot(e.u, e.v) + dot(w, e.uv), dot(e.v, e.v) + dot(w, e.vv)]];
      const det = J[0]![0]! * J[1]![1]! - J[0]![1]! * J[1]![0]!; if (!(Math.abs(det) > 0)) break;
      const a = (F[0]! * J[1]![1]! - F[1]! * J[0]![1]!) / det, b = (J[0]![0]! * F[1]! - J[1]![0]! * F[0]!) / det;
      let lam = 1, moved = false;
      for (let h = 0; h < 40; h++) { const e2 = D2(u - lam * a, v - lam * b); const w2 = sub(e2.p, p); const d2 = dot(w2, w2); if (d2 <= dd * (1 + 1e-14)) { u -= lam * a; v -= lam * b; e = e2; w = w2; dd = d2; moved = true; break; } lam /= 2; }
      if (!moved) break;
    }
    if (!ok) ok = along() < 1e-10;
    if (!ok || !(u > U0 - 0.5 * du0 && u < U1 + 0.5 * du0 && v > V0 - 0.5 * dv0 && v < V1 + 0.5 * dv0)) { if (last) { last = null; return fn(p); } }
    last = [u, v];
    const n = unit(cross(e.u, e.v));
    return { d: dot(sub(p, e.p), n), uv: [u, v] as [number, number] };
  };
  // where to start Newton from: given parameters, or a vertex's own on this face (from a pcurve of one of its edges); a global projection only if neither
  const seed = (uv: [number, number]) => { last = [...uv]; };
  const seedAt = (V: any) => { try { const q = oc.BRep_Tool.Parameters(oc.TopoDS.Vertex(V), face); last = [q.X(), q.Y()]; q.delete(); } catch { /* not on this face: the start is found without it */ } };
  return Object.assign(fn, { seed, seedAt });
}
/** The foot of q on a B-spline surface (an exact round): the nearest of a coarse grid, then Newton; no global projection (see `projector`). */
function footOnRound(oc: any, S: any, q: V3, u0: number, u1: number) {
  const A = new oc.GeomAdaptor_Surface(S); let best = Infinity, bu = u0, bv = 0;
  for (let i = 0; i <= 64; i++) for (let j = 0; j <= 4; j++) { const u = u0 + ((u1 - u0) * i) / 64, v = j / 4; const d = len(sub(take(A.Value(u, v)), q)); if (d < best) { best = d; bu = u; bv = v; } }
  let u = bu, v = bv;
  for (let it = 0; it < 30; it++) {
    const e = sD2(oc, A, u, v); const w = sub(e.p, q);
    const F = [dot(w, e.u), dot(w, e.v)]; const J = [[dot(e.u, e.u) + dot(w, e.uu), dot(e.u, e.v) + dot(w, e.uv)], [dot(e.u, e.v) + dot(w, e.uv), dot(e.v, e.v) + dot(w, e.vv)]];
    const det = J[0]![0]! * J[1]![1]! - J[0]![1]! * J[1]![0]!; if (!(Math.abs(det) > 0)) break;
    const a = (F[0]! * J[1]![1]! - F[1]! * J[0]![1]!) / det, b = (J[0]![0]! * F[1]! - J[1]![0]! * F[0]!) / det; u -= a; v -= b; if (Math.abs(a) + Math.abs(b) < 1e-15) break;
  }
  A.delete(); return [u, v] as [number, number];
}
/** A root of f near x0 (secant), f continuous. */
function root(f: (x: number) => number, x0: number, h: number) {
  let a = x0, b = x0 + h, fa = f(a), fb = f(b);
  for (let i = 0; i < 80 && Math.abs(fb) > 1e-15 && fb !== fa; i++) { const c = b - (fb * (b - a)) / (fb - fa); a = b; fa = fb; b = c; fb = f(b); }
  return b;
}

export interface ExactifyResult { shape: any; round: any; rounds: any[]; info: any }

/**
 * `shape`: the body OCCT rounded; `Fold`: its round face (as found in `shape`); `supFaces`: the two faces it rolls on (in `shape`); `sharp`: a
 * BRepAdaptor_Curve of the sharp edge before rounding; r: radius; sgn: +1 when the ball is on the side the supports' face normals point to.
 */
export function exactify(oc: any, shape: any, FoldIn: any, supFaces: any[], sharp: any, r: number, sgn: number, seamSwap = true, original?: any, others: any[] = []): ExactifyResult {
  const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE, EDGE = oc.TopAbs_ShapeEnum.TopAbs_EDGE, VERT = oc.TopAbs_ShapeEnum.TopAbs_VERTEX, WIRE = oc.TopAbs_ShapeEnum.TopAbs_WIRE;
  const FWD = oc.TopAbs_Orientation.TopAbs_FORWARD, REV = oc.TopAbs_Orientation.TopAbs_REVERSED;
  const list = (s: any, kind: any) => { const out: any[] = []; for (const ex = new oc.TopExp_Explorer(s, kind, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) out.push(ex.Current()); return out; };
  const uniq = (xs: any[]) => { const out: any[] = []; for (const x of xs) if (!out.some((y) => y.IsSame(x))) out.push(x); return out; };
  const faces = list(shape, FACE).map((x) => oc.TopoDS.Face(x));
  const info: any = {};
  // projectors made here, freed on the way out (see `projector`)
  const keep: { release(): void }[] = [];
  try {
  // one or several round faces of one tangent chain: they all lie on one exact surface
  const Folds: any[] = Array.isArray(FoldIn) ? FoldIn : [FoldIn]; const Fold = Folds[0];
  const isRound = (f: any) => Folds.some((x) => x.IsSame(f));
  let sup: Support[] = supFaces.map((f) => {
    const support = supportOf(oc, f);
    keep.push(support);
    return support;
  });
  let sF = [...supFaces];
  const Fedges = uniq(Folds.flatMap((F) => list(F, EDGE))).map((e) => oc.TopoDS.Edge(e.Oriented(FWD)));
  const samplesOn = (e: any) => { const c = new oc.BRepAdaptor_Curve(e); return [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => pt(c.Value(c.FirstParameter() + (c.LastParameter() - c.FirstParameter()) * f))); };
  const onSup = (e: any, k: number) => Math.max(...samplesOn(e).map((p) => sup[k]!.dist(p)));
  const kindOf = (e: any) => { if (Folds.some((F) => oc.BRep_Tool.IsClosed(e, F))) return 'seam'; if (Folds.filter((F) => list(F, EDGE).some((x) => x.IsSame(e))).length > 1) return 'joint'; if (others.some((N) => list(N, EDGE).some((x) => x.IsSame(e)))) return 'pjoint'; const lim = Math.max(1e-5, 10 * oc.BRep_Tool.Tolerance(e)); const d0 = onSup(e, 0), d1 = onSup(e, 1); return d0 < lim && d0 < d1 ? 'c0' : d1 < lim ? 'c1' : 'end'; };
  // the face across an end edge
  const across = (e: any) => faces.find((f) => !isRound(f) && list(f, EDGE).some((x) => x.IsSame(e)));
  const closed = sharp.Value(sharp.FirstParameter()).Distance(sharp.Value(sharp.LastParameter())) < 1e-9;

  // orientation: the exact surface's own normal must agree with the round face's own normal
  const build = (tStart: number | undefined, pin: any, span?: [number, number]) => {
    // an open round is built past both ends of the sharp edge, and trimmed by the faces it ends on
    let ca = sharp;
    if (span) { if (sharp.composite) ca = sharp.extended(span[0], span[1]); else { const c = oc.BRep_Tool.Curve(sharpEdgeOf(sharp), 0, 0); ca = new oc.GeomAdaptor_Curve(c.returnValue ?? c, span[0], span[1]); } }
    // as few sections as keep the surface on the ball to ROUND_ACCURACY: a round of hundreds of poles is slow for everything after it (offsets,
    // booleans, meshing), and most edges need a few dozen
    let best: any = null;
    // the error of degree-5 interpolation falls as the sixth power of the spacing: from the first try, go straight to the count that should do
    let ns = ROUND_SECTIONS_MIN;
    for (;;) {
      const e = exactRound(oc, sup[0]!, sup[1]!, ca, r, sgn, ns, 5, tStart, pin);
      const dev = e.accuracy(Math.min(2 * ns, 256));
      best = e; info.sections = ns; info.buildDeviation = dev;
      if (dev <= ROUND_ACCURACY || ns >= ROUND_SECTIONS) break;
      ns = Math.min(ROUND_SECTIONS, Math.max(2 * ns, Math.ceil(1.3 * ns * Math.pow(dev / ROUND_ACCURACY, 1 / 6))));
    }
    return best;
  };
  const sharpEdgeOf = (c: any) => c.Edge();
  let span: [number, number] | undefined;
  if (!closed) { const a = sharp.FirstParameter(), b = sharp.LastParameter(); const sp = len(cD1(oc, sharp, (a + b) / 2).d); const d = (4 * r) / sp; span = [a - d, b + d]; }
  // where the round joins the round of the next stretch of the chain, on another support (the wall turns from one face to the next, smoothly): the
  // section of the ball whose contact on the support that changes is on the edge between its two faces (C2.11). Both stretches find the same ball there.
  const othersEdges = others.flatMap((N) => list(N, EDGE));
  const pjoints = Fedges.flatMap((e, ei) => {
    if (!othersEdges.some((x) => x.IsSame(e))) return [];
    const vs = list(e, VERT).map((v) => oc.TopoDS.Vertex(v.Oriented(FWD)));
    let hit: { k: number; B: any } | null = null;
    for (const k of [0, 1]) for (const V of vs) {
      const bs = list(sF[k], EDGE).map((x) => oc.TopoDS.Edge(x.Oriented(FWD))).filter((x) => !Fedges.some((y) => y.IsSame(x)) && !othersEdges.some((y) => y.IsSame(x)) && list(x, VERT).some((w) => w.IsSame(V)));
      if (bs.length === 1) { if (hit) throw new Error('round joint: both supports change at once'); hit = { k, B: bs[0] }; }
    }
    if (!hit) throw new Error('round joint: no edge between the faces of the support that changes');
    return [{ ei, ...hit }];
  });
  const tJ = new Map<number, number>();
  if (pjoints.length) {
    if (closed || !span) throw new Error('round joint on a closed round');
    const a = sharp.FirstParameter(), b = sharp.LastParameter();
    const sec = ballSections(oc, sup[0]!, sup[1]!, sharp, r, sgn);
    for (const j of pjoints) {
      const Bcrv = oc.BRep_Tool.Curve(j.B, 0, 0); const BG = Bcrv.returnValue ?? Bcrv;
      // start from the sharp edge's point nearest OCCT's joint
      const m = (() => { const c = new oc.BRepAdaptor_Curve(Fedges[j.ei]); return pt(c.Value((c.FirstParameter() + c.LastParameter()) / 2)); })();
      let t0 = a, best = Infinity; const lo = span[0], hi = span[1];
      for (let i = 0; i <= 400; i++) { const t2 = lo + ((hi - lo) * i) / 400; const d2 = len(sub(take(sharp.Value(t2)), m)); if (d2 < best) { best = d2; t0 = t2; } }
      // each evaluation from its own start (a guess carried over from a far section can settle on another ball), the two beside it from its own
      const k2 = j.k * 2; const at = (q: any) => sup[j.k]!.ev(q.x[k2]!, q.x[k2 + 1]!).p;
      const h = 1e-6 * (hi - lo);
      const g = (t2: number) => { const q0 = sec(t2); const P = at(q0); const g2 = new oc.gp_Pnt(P[0], P[1], P[2]); const pr = new oc.GeomAPI_ProjectPointOnCurve(g2, BG); const foot = take(pr.NearestPoint()); pr.delete(); g2.delete(); const d = sub(at(sec(t2 + h, q0.x)), at(sec(t2 - h, q0.x))); return dot(sub(P, foot), d) / len(d); };
      const t = root(g, t0, 1e-3 * (hi - lo));
      if (!(Math.abs(g(t)) < 1e-12) || !(t > lo && t < hi)) throw new Error(`round joint: the ball's contact does not cross the support's edge (${g(t).toExponential(2)})`);
      tJ.set(j.ei, t);
    }
    // each joint ends the stretch on the side it is nearest
    for (const [, t] of tJ) { if (Math.abs(t - a) < Math.abs(t - b)) span[0] = t; else span[1] = t; }
    info.pjoints = [...tJ.values()].map((t) => +t.toFixed(6));
  }
  let ex = build(undefined, undefined, span);
  {
    const ad = new oc.BRepAdaptor_Surface(Fold, true); const um = (ad.FirstUParameter() + ad.LastUParameter()) / 2, vm = (ad.FirstVParameter() + ad.LastVParameter()) / 2;
    const d = sD1(oc, ad, um, vm); ad.delete(); const n0 = unit(cross(d.du, d.dv));
    const o1 = footOnRound(oc, ex.surf, d.p, ex.u0, ex.u1);
    const gs = new oc.GeomAdaptor_Surface(ex.surf); const e1 = sD1(oc, gs, o1[0], o1[1]); gs.delete();
    if (dot(n0, unit(cross(e1.du, e1.dv))) < 0) { sup = [sup[1]!, sup[0]!]; sF = [sF[1], sF[0]]; ex = build(undefined, undefined, span); info.swapped = true; }
  }
  const kinds = Fedges.map(kindOf); info.kinds = kinds;
  if (closed) {
    const seam = Fedges[kinds.indexOf('seam')];
    if (!seam) throw new Error('closed round without a seam');
    // start at OCCT's seam, pinned to the seam of a periodic support so the vertex stays at its end
    const c = new oc.BRepAdaptor_Curve(seam); const q = pt(c.Value(c.FirstParameter()));
    const a = sharp.FirstParameter(), b = sharp.LastParameter(); let best = Infinity, bt = a; const N = 4000;
    for (let i = 0; i < N; i++) { const t2 = a + ((b - a) * i) / N; const d2 = len(sub(take(sharp.Value(t2)), q)); if (d2 < best) { best = d2; bt = t2; } }
    let pin: any;
    for (const k of [0, 1]) { const adS = new oc.BRepAdaptor_Surface(sF[k], true); if (adS.IsUPeriodic()) pin = { index: k * 2, value: adS.FirstUParameter(), period: adS.UPeriod() }; }
    ex = build(bt, pin);
  }
  if (closed && kinds.includes('joint') && !kinds.includes('seam')) throw new Error('a closed chain of several round faces is not handled yet');
  const L = ex.u1; const tol = 1e-7; const B = new oc.BRep_Builder(); const loc = new oc.TopLoc_Location();
  const S = new oc.GeomAdaptor_Surface(ex.surf);
  const Sv = (u: number, v: number): V3 => take(S.Value(u, v));
  const iso = [ex.surf.VIso(0), ex.surf.VIso(1)];
  // the parameter of a point on a contact curve (an iso-curve of the round): the nearest of a coarse sampling, then Newton (a GeomAPI projection onto a
  // curve of hundreds of poles keeps heap as one onto a surface does)
  const isoA = iso.map((c: any) => new oc.GeomAdaptor_Curve(c));
  const uOnIso = (k: number, p: any) => {
    const q: V3 = Array.isArray(p) ? (p as V3) : pt(p); const A2 = isoA[k]; const a = A2.FirstParameter(), b = A2.LastParameter(); let best = Infinity, u = a;
    for (let i = 0; i <= 256; i++) { const x = a + ((b - a) * i) / 256; const d = len(sub(take(A2.Value(x)), q)); if (d < best) { best = d; u = x; } }
    for (let it = 0; it < 30; it++) { const d = cD2(oc, A2, u); const P = d.p, D1 = d.d, D2 = d.dd; const w = sub(P, q); const f = dot(w, D1), df = dot(D1, D1) + dot(w, D2); if (!(Math.abs(df) > 0)) break; const du = f / df; u -= du; if (Math.abs(du) < 1e-15 * (1 + Math.abs(u))) break; }
    return u;
  };
  const periodOf = (f: any) => { const a = new oc.BRepAdaptor_Surface(f, true); return [a.IsUPeriodic() ? a.UPeriod() : 0, a.IsVPeriodic() ? a.VPeriod() : 0] as [number, number]; };

  // the parameters on the contact curves where each old vertex goes
  const endU = (k: number, V: any, endFace: any) => {
    const sd = signedNear(oc, endFace, keep); sd.seedAt(V); const u0 = uOnIso(k, oc.BRep_Tool.Pnt(V)); const u = root((x) => sd(Sv(x, k)).d, u0, 1e-4);
    const d = sd(Sv(u, k)).d; if (!(Math.abs(d) < 1e-9)) throw new Error(`contact end: the contact does not meet the face it ends on (${d.toExponential(2)})`);
    return u;
  };
  const vertexKey: { V: any; p: V3 }[] = [];
  const setV = (V: any, p: V3) => { const e = vertexKey.find((x) => x.V.IsSame(V)); if (e) { info.vertexDisagree = Math.max(info.vertexDisagree ?? 0, len(sub(e.p, p))); return; } vertexKey.push({ V, p }); };

  const newOf: any[] = [], flips: boolean[] = [];
  const FnewFs = Folds.map(() => { const f = new oc.TopoDS_Face(); B.MakeFace(f, ex.surf, loc, tol); return f; }); const FnewF = FnewFs[0];
  // each joint between two round faces of the chain: one section of the ball, at u = jointU. Where a periodic support's own seam meets the joint
  // (OCCT splits the chain there) the section is the one whose contact is on that seam, so the vertex stays at the seam's end; elsewhere any section
  // will do, and the one nearest OCCT's joint is taken
  const jointU = new Map<number, number>();
  Fedges.forEach((e, ei) => {
    if (kinds[ei] !== 'joint') return;
    const vs = list(e, VERT).map((v) => oc.TopoDS.Vertex(v.Oriented(FWD)));
    let u: number | null = null;
    for (const k of [0, 1]) {
      const adS = new oc.BRepAdaptor_Surface(sF[k], true); if (!adS.IsUPeriodic()) continue;
      const V = vs.find((v) => sup[k]!.dist(pt(oc.BRep_Tool.Pnt(v))) < sup[1 - k]!.dist(pt(oc.BRep_Tool.Pnt(v))));
      const T = adS.UPeriod(), seamU = adS.FirstUParameter();
      const uvV = sup[k]!.proj(pt(oc.BRep_Tool.Pnt(V)));
      const offSeam = Math.abs(((uvV[0] - seamU) % T + 1.5 * T) % T - 0.5 * T);
      if (offSeam > 1e-3) continue;
      const pc = ex.pcurve(k * 2, [T, 0]); const wrapD = (d: number) => d - T * Math.round(d / T);
      u = root((x) => { const q2 = pc.Value(x); const X = q2.X(); q2.delete(); return wrapD(X - seamU); }, uOnIso(k, oc.BRep_Tool.Pnt(V)), 1e-5); info.jointPinned = true;
    }
    const uJ: number = u ?? uOnIso(0, oc.BRep_Tool.Pnt(vs.find((v) => sup[0]!.dist(pt(oc.BRep_Tool.Pnt(v))) < sup[1]!.dist(pt(oc.BRep_Tool.Pnt(v))))));
    jointU.set(ei, uJ);
  });
  // a joint to the next stretch is a section at an end of this round's surface
  for (const [ei, t] of tJ) jointU.set(ei, Math.abs(t - span![0]) < Math.abs(t - span![1]) ? 0 : L);
  const jointAt = (V: any) => { for (const [ei, u] of jointU) if (list(Fedges[ei], VERT).some((w) => w.IsSame(V))) return u; return null; };
  // end faces of each contact end: the face across the end edge that shares the vertex
  const endEdges = Fedges.filter((_, i) => kinds[i] === 'end');
  const endFaceAt = (V: any) => { const e = endEdges.find((x) => list(x, VERT).some((w) => w.IsSame(V))); return e ? across(e) : null; };
  const contactRange: { k: number; ua: number; ub: number; Va: any; Vb: any }[] = [];
  Fedges.forEach((e, ei) => {
    const ca = new oc.BRepAdaptor_Curve(e); const a0 = ca.FirstParameter(), a1 = ca.LastParameter();
    const E2 = new oc.TopoDS_Edge();
    const vs = list(e, VERT); const Vf = oc.TopoDS.Vertex(vs.find((v) => v.Orientation() === FWD).Oriented(FWD)); const Vl = oc.TopoDS.Vertex(vs.find((v) => v.Orientation() === REV).Oriented(FWD));
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
      const k = kinds[ei] === 'c0' ? 0 : 1;
      const d = cD1(oc, ca, (a0 + a1) / 2); const um = uOnIso(k, d.p);
      { const gi = new oc.GeomAdaptor_Curve(iso[k]); flips[ei] = dot(d.d, cD1(oc, gi, um).d) < 0; gi.delete(); }
      let ua: number, ub: number, Va: any, Vb: any;
      if (closed) { ua = 0; ub = L; Va = Vb = Vf; }
      else {
        [Va, Vb] = flips[ei] ? [Vl, Vf] : [Vf, Vl];
        const ja = jointAt(Va), jb = jointAt(Vb); const fa = ja === null ? endFaceAt(Va) : null, fb = jb === null ? endFaceAt(Vb) : null; if ((ja === null && !fa) || (jb === null && !fb)) throw new Error('contact end without an end face');
        ua = ja ?? endU(k, Va, fa); ub = jb ?? endU(k, Vb, fb);
        if (!(ub > ua)) throw new Error('contact runs backwards');
      }
      B.MakeEdge(E2, iso[k], tol);
      B.Add(E2, Va.Oriented(FWD)); B.Add(E2, Vb.Oriented(REV)); B.Range(E2, ua, ub, false);
      B.UpdateEdge(E2, new oc.Geom2d_Line(new oc.gp_Pnt2d(0, k), new oc.gp_Dir2d(1, 0)), FnewF, tol);
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
  Fedges.forEach((e, ei) => {
    if (kinds[ei] !== 'joint' && kinds[ei] !== 'pjoint') return;
    const u = jointU.get(ei)!; const ca = new oc.BRepAdaptor_Curve(e);
    const vs = list(e, VERT); const Vf = oc.TopoDS.Vertex(vs.find((v) => v.Orientation() === FWD).Oriented(FWD)); const Vl = oc.TopoDS.Vertex(vs.find((v) => v.Orientation() === REV).Oriented(FWD));
    flips[ei] = !(sup[0]!.dist(pt(ca.Value(ca.FirstParameter()))) < sup[1]!.dist(pt(ca.Value(ca.FirstParameter()))));
    const [V0, V1] = flips[ei] ? [Vl, Vf] : [Vf, Vl];
    const E2 = new oc.TopoDS_Edge(); B.MakeEdge(E2, ex.surf.UIso(u), tol);
    B.Add(E2, V0.Oriented(FWD)); B.Add(E2, V1.Oriented(REV)); B.Range(E2, 0, 1, false);
    B.UpdateEdge(E2, new oc.Geom2d_Line(new oc.gp_Pnt2d(u, 0), new oc.gp_Dir2d(0, 1)), FnewF, tol);
    if (kinds[ei] === 'pjoint') {
      // the round of the next stretch keeps its own surface (OCCT's, until its turn comes, or an exact one already): a pcurve on it by projection
      const N2 = others.find((N) => list(N, EDGE).some((x) => x.IsSame(e))); const SN2 = oc.BRep_Tool.Surface(N2); const per = periodOf(N2); const GA = new oc.GeomAdaptor_Surface(SN2);
      const sd = signedNear(oc, N2, keep); sd.seedAt(flips[ei] ? Vl : Vf); const M = 40; const ss: number[] = [], P2: number[][] = []; let gap2 = 0;
      for (let q = 0; q <= M; q++) { const v = q / M; const p = Sv(u, v); const f = sd(p); ss.push(v); P2.push(f.uv); gap2 = Math.max(gap2, Math.abs(f.d)); }
      for (let q = 1; q < P2.length; q++) for (const dd of [0, 1]) if (per[dd]) { while (P2[q]![dd]! - P2[q - 1]![dd]! > per[dd]! / 2) P2[q]![dd]! -= per[dd]!; while (P2[q]![dd]! - P2[q - 1]![dd]! < -per[dd]! / 2) P2[q]![dd]! += per[dd]!; }
      const pc = curve2(oc, ss, P2, 5);
      for (let q = 0; q < 2 * M; q++) { const v = (q + 0.5) / (2 * M); const a2 = pc.Value(v); gap2 = Math.max(gap2, len(sub(Sv(u, v), take(GA.Value(a2.X(), a2.Y()))))); a2.delete(); }
      { const o2 = new oc.BRepAdaptor_Curve2d(e, N2); const ref = o2.Value(flips[ei] ? o2.LastParameter() : o2.FirstParameter()); const mine = pc.Value(0); const dx = per[0] ? per[0] * Math.round((ref.X() - mine.X()) / per[0]) : 0, dy = per[1] ? per[1] * Math.round((ref.Y() - mine.Y()) / per[1]) : 0; if (dx || dy) pc.Translate(new oc.gp_Vec2d(dx, dy)); }
      const tl = Math.max(tol, 1.5 * gap2); B.UpdateEdge(E2, pc, N2, tl); (info.pjointGap ??= []).push(+gap2.toExponential(2));
      B.UpdateVertex(oc.TopoDS.Vertex(V0.Oriented(FWD)), 0, E2, tl); B.UpdateVertex(oc.TopoDS.Vertex(V1.Oriented(REV)), 1, E2, tl);
    } else { B.UpdateVertex(oc.TopoDS.Vertex(V0.Oriented(FWD)), 0, E2, tol); B.UpdateVertex(oc.TopoDS.Vertex(V1.Oriented(REV)), 1, E2, tol); }
    setV(V0, Sv(u, 0)); setV(V1, Sv(u, 1));
    newOf[ei] = E2;
  });
  // end edges: where the round crosses a face it ends on. An end may be one edge from contact 0 to contact 1 (v from 0 to 1), or a run of several,
  // each on a different face (two rounds meeting at a point cut each other, and the wall beyond: C2.11); the vertex between two of them is where the
  // round meets both faces, solved on the exact surface
  const endInfo = new Map<number, { G: any; sd: ReturnType<typeof signedNear> }>();
  Fedges.forEach((e, ei) => { if (kinds[ei] === 'end') { const G = across(e); if (!G) throw new Error('end edge without a face across'); endInfo.set(ei, { G, sd: signedNear(oc, G, keep) }); } });
  const cornerUV: { V: any; uv: [number, number] }[] = [];
  const endPointUV = (V: any, ei: number): [number, number] => {
    for (const c of contactRange) { if (c.Va.IsSame(V)) return [c.ua, c.k]; if (c.Vb.IsSame(V)) return [c.ub, c.k]; }
    const known = cornerUV.find((x) => x.V.IsSame(V)); if (known) return known.uv;
    const other = Fedges.findIndex((x, i) => i !== ei && kinds[i] === 'end' && list(x, VERT).some((w) => w.IsSame(V)));
    if (other < 0) throw new Error('end vertex on no contact and no other end edge');
    const fa = endInfo.get(ei)!.sd, fb = endInfo.get(other)!.sd;
    const o0 = footOnRound(oc, ex.surf, pt(oc.BRep_Tool.Pnt(V)), 0, L); const uv0 = { U: o0[0], V: o0[1] }; endInfo.get(ei)!.sd.seedAt(V); endInfo.get(other)!.sd.seedAt(V);
    // the two faces across meet along an edge of the body through V (the other round's contact on the wall, where they are tangent, so their own
    // distances are no use there): the corner is where the round crosses that edge's curve. Damped Newton, as the crossing can be shallow.
    const third = faces.flatMap((f) => list(f, EDGE)).map((x) => oc.TopoDS.Edge(x.Oriented(FWD))).find((x) => !Fedges.some((y) => y.IsSame(x)) && list(x, VERT).some((w) => w.IsSame(V)) && [endInfo.get(ei)!.G, endInfo.get(other)!.G].every((G) => list(G, EDGE).some((y) => y.IsSame(x))));
    let x: number[]; let F: (q: number[]) => number[];
    const nrm = (f: number[]) => f.reduce((a2, q) => a2 + Math.abs(q), 0);
    if (third) {
      const C = new oc.BRepAdaptor_Curve(third); const tV = oc.BRep_Tool.Parameter(V, third);
      F = (q) => { const p = Sv(q[0]!, q[1]!); const c = take(C.Value(q[2]!)); return sub(p, c); };
      x = [uv0.U, uv0.V, tV]; info.endCornerOnEdge = true;
    } else {
      F = (q) => { const p = Sv(q[0]!, q[1]!); return [fa(p).d, fb(p).d]; };
      x = [uv0.U, uv0.V];
    }
    let f = F(x);
    for (let it = 0; it < 60 && nrm(f) >= 1e-14; it++) {
      const n = x.length; const J: number[][] = f.map(() => []);
      for (let q = 0; q < n; q++) { const h = q === 1 ? 1e-8 : 1e-6; const xp = [...x], xm = [...x]; xp[q]! += h; xm[q]! -= h; const fp = F(xp), fm = F(xm); for (let w = 0; w < f.length; w++) J[w]![q] = (fp[w]! - fm[w]!) / (2 * h); }
      let dx: number[];
      try { dx = solve(J, f.map((q) => [q])).map((q) => q[0]!); } catch { throw new Error('end corner: singular'); }
      if (!dx.every(Number.isFinite)) throw new Error('end corner: singular');
      let lam = 1, nx = x.map((q, k2) => q - dx[k2]!), nf = F(nx);
      while (nrm(nf) > nrm(f) && lam > 1e-6) { lam /= 2; nx = x.map((q, k2) => q - lam * dx[k2]!); nf = F(nx); }
      if (nrm(nf) > nrm(f)) break;
      x = nx; f = nf;
    }
    if (!(nrm(f) < 1e-11) || !(x[1]! > -1e-9 && x[1]! < 1 + 1e-9)) throw new Error(`end corner not found on the round (${nrm(f).toExponential(2)})`);
    const uv: [number, number] = [x[0]!, x[1]!]; cornerUV.push({ V, uv }); setV(V, Sv(uv[0], uv[1])); (info.endCorners ??= []).push(+len(sub(Sv(uv[0], uv[1]), pt(oc.BRep_Tool.Pnt(V)))).toExponential(2));
    return uv;
  };
  Fedges.forEach((e, ei) => {
    if (kinds[ei] !== 'end') return;
    const { G, sd } = endInfo.get(ei)!;
    const vs = list(e, VERT); const Vf = oc.TopoDS.Vertex(vs.find((v) => v.Orientation() === FWD).Oriented(FWD)); const Vl = oc.TopoDS.Vertex(vs.find((v) => v.Orientation() === REV).Oriented(FWD));
    const uvF = endPointUV(Vf, ei), uvL = endPointUV(Vl, ei);
    // the new edge runs from the end of smaller v to the larger (v from 0 to 1 when it spans the round)
    flips[ei] = uvF[1] > uvL[1];
    const [V0, V1] = flips[ei] ? [Vl, Vf] : [Vf, Vl]; const [a0, a1] = flips[ei] ? [uvL, uvF] : [uvF, uvL];
    const per = periodOf(G); const SG = new oc.GeomAdaptor_Surface(oc.BRep_Tool.Surface(G));
    // as many samples as keep the curve and both pcurves together within a tenth of the edge tolerance between them: the face across may be another
    // round (OCCT's B-spline of many patches, or an exact one of many sections), whose cut is less smooth than a plane's
    let C3: any, pcR: any, pcG: any; let gap = Infinity;
    for (let N = 40; ; N *= 2) {
      sd.seedAt(V0);
      const ss: number[] = [], uu: number[] = [], vv: number[] = [], P3: V3[] = [], P2: number[][] = [];
      let uPrev = a0[0];
      for (let j = 0; j <= N; j++) {
        const s2 = j / N; const v = a0[1] + (a1[1] - a0[1]) * s2;
        const u = j === 0 ? a0[0] : j === N ? a1[0] : root((x) => sd(Sv(x, v)).d, uPrev + (a1[0] - a0[0]) / N, 1e-5);
        uPrev = u; ss.push(s2); uu.push(u); vv.push(v); const p = Sv(u, v); const q = sd(p); if (!(Math.abs(q.d) < (j === 0 || j === N ? 1e-5 : 1e-9))) throw new Error(`end edge: no cut at v = ${v.toFixed(4)} (${q.d.toExponential(2)}, sample ${j}/${N}, u ${u.toFixed(4)} from ${a0[0].toFixed(4)}..${a1[0].toFixed(4)})`); P3.push(p); P2.push(q.uv);
      }
      for (let j = 1; j < P2.length; j++) for (const dd of [0, 1]) if (per[dd]) { while (P2[j]![dd]! - P2[j - 1]![dd]! > per[dd]! / 2) P2[j]![dd]! -= per[dd]!; while (P2[j]![dd]! - P2[j - 1]![dd]! < -per[dd]! / 2) P2[j]![dd]! += per[dd]!; }
      C3 = curve3(oc, ss, P3, 5); pcR = curve2(oc, ss, uu.map((u, j) => [u, vv[j]!]), 5); pcG = curve2(oc, ss, P2, 5);
      gap = 0;
      for (let j = 0; j <= 2 * N; j++) { const s2 = j / (2 * N); const p = take(C3.Value(s2)); const a = pcR.Value(s2), b = pcG.Value(s2); gap = Math.max(gap, len(sub(p, Sv(a.X(), a.Y()))), len(sub(p, take(SG.Value(b.X(), b.Y()))))); a.delete(); b.delete(); }
      if (gap <= tol / 10 || N >= 160) break;
      // the ends are where they are (a corner on another face's edge may lie off this face by that edge's own tolerance): more samples do not help
      if (N >= 80 && gap <= 1e-5) break;
    }
    (info.endGap ??= []).push(+gap.toExponential(2));
    if (!(gap <= 1e-5)) throw new Error(`end edge: curve and pcurves ${gap.toExponential(2)} apart (G ${oc.BRep_Tool.Surface(G).DynamicType().Name()})`);
    const tolE = Math.max(tol, 1.5 * gap); const E2 = new oc.TopoDS_Edge(); B.MakeEdge(E2, C3, tolE);
    B.Add(E2, V0.Oriented(FWD)); B.Add(E2, V1.Oriented(REV)); B.Range(E2, 0, 1, false);
    B.UpdateEdge(E2, pcR, FnewF, tol);
    { const o2 = new oc.BRepAdaptor_Curve2d(e, G); const ref = o2.Value(flips[ei] ? o2.LastParameter() : o2.FirstParameter()); const mine = pcG.Value(0); const dx = per[0] ? per[0] * Math.round((ref.X() - mine.X()) / per[0]) : 0, dy = per[1] ? per[1] * Math.round((ref.Y() - mine.Y()) / per[1]) : 0; if (dx || dy) pcG.Translate(new oc.gp_Vec2d(dx, dy)); }
    B.UpdateEdge(E2, pcG, G, tol);
    B.UpdateVertex(oc.TopoDS.Vertex(V0.Oriented(FWD)), 0, E2, tol); B.UpdateVertex(oc.TopoDS.Vertex(V1.Oriented(REV)), 1, E2, tol);
    newOf[ei] = E2;
  });
  // the cut of two faces' surfaces from one vertex to the other, along an edge's own curve (run on past its ends) as the guess: each sample refined by
  // Newton onto both surfaces (in the plane square to the curve there), the curve and both pcurves interpolated, exact at the samples
  const recut = (ed: any, two: any[], vs: any[], hit: { V: any; p: V3 }[]) => {
    const C0 = oc.BRep_Tool.Curve(ed, 0, 0); const crv = C0.returnValue ?? C0; const gc = new oc.GeomAdaptor_Curve(crv);
    const c = new oc.BRepAdaptor_Curve(ed); const f0 = c.FirstParameter(), f1 = c.LastParameter();
    const ends = vs.map((v: any) => { const k = hit.find((h) => h.V.IsSame(v)); const P = k ? k.p : pt(oc.BRep_Tool.Pnt(oc.TopoDS.Vertex(v))); const old = v.Orientation() === FWD ? f0 : f1; const d = cD1(oc, gc, old); const T = d.d; const par = old + dot(sub(P, d.p), T) / dot(T, T); return { v: oc.TopoDS.Vertex(v.Oriented(FWD)), fwd: v.Orientation() === FWD, P, par }; });
    const a = ends.find((x: any) => x.fwd), b = ends.find((x: any) => !x.fwd); if (!a || !b || !(b.par > a.par)) return null;
    const S = two.map((f: any) => new oc.GeomAdaptor_Surface(oc.BRep_Tool.Surface(f)));
    // Newton marches from the first vertex's own parameters on both faces, each sample from the last
    let prev: number[] = two.flatMap((f: any) => { const q = oc.BRep_Tool.Parameters(a.v, f); const o = [q.X(), q.Y()]; q.delete(); return o; });
    const ev = (k: number, u: number, v: number) => sD1(oc, S[k], u, v);
    const N = 40; const ss: number[] = [], P3: V3[] = [], uv: number[][][] = [[], []]; let gap = 0;
    for (let j = 0; j <= N; j++) {
      const q = a.par + ((b.par - a.par) * j) / N; const d = cD1(oc, gc, q); const g = j === 0 ? a.P : j === N ? b.P : d.p; const T = unit(d.d);
      let x = [...prev];
      const F = (y: number[]) => { const A2 = ev(0, y[0]!, y[1]!).p, B2 = ev(1, y[2]!, y[3]!).p; return [...sub(A2, B2), dot(sub(A2, g), T)]; };
      for (let it = 0; it < 30; it++) {
        const f = F(x); if (Math.hypot(...f) < 1e-15) break;
        const J: number[][] = [[], [], [], []]; for (let q2 = 0; q2 < 4; q2++) { const h = 1e-7; const xp = [...x], xm = [...x]; xp[q2]! += h; xm[q2]! -= h; const fp = F(xp), fm = F(xm); for (let w = 0; w < 4; w++) J[w]![q2] = (fp[w]! - fm[w]!) / (2 * h); }
        const dx = solve(J, f.map((v) => [v])).map((v) => v[0]!); if (!dx.every(Number.isFinite)) return null; x = x.map((v, q2) => v - dx[q2]!);
      }
      prev = x; const P = ev(0, x[0]!, x[1]!).p; gap = Math.max(gap, len(sub(P, ev(1, x[2]!, x[3]!).p)));
      if (j === 0 || j === N) gap = Math.max(gap, len(sub(P, g)));
      ss.push(q); P3.push(j === 0 ? a.P : j === N ? b.P : P); uv[0]!.push([x[0]!, x[1]!]); uv[1]!.push([x[2]!, x[3]!]);
    }
    if (!(gap < 1e-6)) return null;
    const NE = new oc.TopoDS_Edge(); const tl = Math.max(tol, 1.5 * gap); B.MakeEdge(NE, curve3(oc, ss, P3, 5), tl);
    B.Add(NE, a.v.Oriented(FWD)); B.Add(NE, b.v.Oriented(REV)); B.Range(NE, a.par, b.par, false);
    two.forEach((f: any, k: number) => {
      const per = periodOf(f); const P2 = uv[k]!; for (let j = 1; j < P2.length; j++) for (const dd of [0, 1]) if (per[dd]) { while (P2[j]![dd]! - P2[j - 1]![dd]! > per[dd]! / 2) P2[j]![dd]! -= per[dd]!; while (P2[j]![dd]! - P2[j - 1]![dd]! < -per[dd]! / 2) P2[j]![dd]! += per[dd]!; }
      const pc = curve2(oc, ss, P2, 5);
      { const o2 = new oc.BRepAdaptor_Curve2d(ed, f); const mid = (f0 + f1) / 2; const ref = o2.Value(mid); const mine = pc.Value(Math.min(b.par, Math.max(a.par, mid))); const dx = per[0] ? per[0] * Math.round((ref.X() - mine.X()) / per[0]) : 0, dy = per[1] ? per[1] * Math.round((ref.Y() - mine.Y()) / per[1]) : 0; if (dx || dy) pc.Translate(new oc.gp_Vec2d(dx, dy)); }
      B.UpdateEdge(NE, pc, f, tl);
    });
    B.UpdateVertex(oc.TopoDS.Vertex(a.v.Oriented(FWD)), a.par, NE, tl); B.UpdateVertex(oc.TopoDS.Vertex(b.v.Oriented(REV)), b.par, NE, tl);
    return NE;
  };
  // move the shared vertices, and every other edge ending at one: its parameter there and its range
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
          const per = periodOf(mf);
          const N = 40; const ss: number[] = [], P2: number[][] = [];
          const sdM = signedNear(oc, mf, keep); sdM.seedAt(s0.v);
          for (let j2 = 0; j2 <= N; j2++) { const q = s0.par + ((s1.par - s0.par) * j2) / N; const o = sdM(take(g2.Value(q))); ss.push(q); P2.push(o.uv); }
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
    // a moved vertex past the end of this edge's own curve, the edge being where two faces cut each other (the cut a round of an earlier chain made with
    // a wall, and this round now ends a little further along it): the edge made anew as the cut of the two surfaces between its vertices, not clamped
    {
      const gcx = new oc.GeomAdaptor_Curve(crv);
      const mf2 = faces.filter((x: any) => list(x, EDGE).some((y: any) => y.IsSame(ed)));
      const beyond = !gcx.IsPeriodic() && mf2.length === 2 && !mf2.some((x: any) => oc.BRep_Tool.IsClosed(ed, x)) && hit.some((h) => { const P = new oc.gp_Pnt(h.p[0], h.p[1], h.p[2]); const pr = new oc.GeomAPI_ProjectPointOnCurve(P, crv); const out = pr.NbPoints() === 0 || pr.LowerDistance() > 1e-9; pr.delete(); P.delete(); return out; });
      if (beyond) { const NE = recut(ed, mf2, vs, hit); if (NE) { extra.push({ old: ed, neu: NE, flip: false }); (info.recut ??= []).push(1); continue; } }
    }
    for (const v of vs) { const k = hit.find((h) => h.V.IsSame(v)); if (!k) continue;
      const P0 = new oc.gp_Pnt(k.p[0], k.p[1], k.p[2]); const pr = new oc.GeomAPI_ProjectPointOnCurve(P0, crv);
      let par: number;
      if (pr.NbPoints() > 0) par = pr.LowerDistanceParameter();
      else { const gc = new oc.GeomAdaptor_Curve(crv); par = gc.Value(f0).Distance(P0) < gc.Value(f1).Distance(P0) ? f0 : f1; par = root((x) => { const d = cD1(oc, gc, x); return dot(sub(d.p, k.p), d.d); }, par, 1e-6 * (f1 - f0)); (info.projFallback ??= []).push(oc.Standard_Type ? '' : 'nearest'); }
      let off = new oc.GeomAdaptor_Curve(crv).Value(par).Distance(new oc.gp_Pnt(k.p[0], k.p[1], k.p[2])); info.offOtherEdge = Math.max(info.offOtherEdge ?? 0, off);
      { const gc = new oc.GeomAdaptor_Curve(crv); const old = v.Orientation() === FWD ? f0 : f1; if (gc.IsPeriodic()) { const T = gc.Period(); par += T * Math.round((old - par) / T); } (info.rangeEdits ??= []).push([+(par - old).toExponential(2), gc.IsPeriodic()]); }
      { const C3 = oc.BRep_Tool.Curve(ed, 0, 0); const crv3 = C3.returnValue ?? C3; const gc = new oc.GeomAdaptor_Curve(crv3); if (!gc.IsPeriodic()) { const d0 = gc.FirstParameter(), d1 = gc.LastParameter(); if (par < d0 || par > d1) { const cl = Math.min(d1, Math.max(d0, par)); const gap = gc.Value(cl).Distance(P0); (info.clamped ??= []).push(+gap.toExponential(2)); par = cl; off = Math.max(off, gap); } } }
      // an edge of the body that is itself an approximation (an intersection curve) passes the exact point only within its own tolerance: the vertex takes that much
      const vt = Math.max(tol, 1.5 * off, oc.BRep_Tool.Tolerance(ed)); if (vt > tol) { B.UpdateVertex(oc.TopoDS.Vertex(v), vt); (info.vertexTol ??= []).push(+vt.toExponential(2)); }
      if (v.Orientation() === FWD) f0 = par; else f1 = par; B.UpdateVertex(oc.TopoDS.Vertex(v), par, ed, Math.max(tol, 1.5 * off)); }
    // a pcurve that does not reach the vertex's new parameter (OCCT's own B-spline pcurve, made for the range it had): made anew on the same 3D curve,
    // by projection at samples, on the same turn of a periodic face
    for (const mf of faces.filter((x: any) => list(x, EDGE).some((y: any) => y.IsSame(ed)))) {
      if (oc.BRep_Tool.IsClosed(ed, mf)) continue;
      const pc0 = new oc.BRepAdaptor_Curve2d(ed, mf).Curve(); if (!pc0) continue;
      const g0 = new oc.Geom2dAdaptor_Curve(pc0); if (g0.IsPeriodic() || (f0 >= g0.FirstParameter() - 1e-12 && f1 <= g0.LastParameter() + 1e-12)) continue;
      const per = periodOf(mf); const gc = new oc.GeomAdaptor_Curve(crv);
      const N = 40; const ss: number[] = [], P2: number[][] = []; let gap2 = 0;
      const sdM = signedNear(oc, mf, keep);
      for (let j2 = 0; j2 <= N; j2++) { const q = f0 + ((f1 - f0) * j2) / N; const w = pc0.Value(Math.min(g0.LastParameter(), Math.max(g0.FirstParameter(), q))); sdM.seed([w.X(), w.Y()]); w.delete(); const o = sdM(take(gc.Value(q))); gap2 = Math.max(gap2, Math.abs(o.d)); ss.push(q); P2.push(o.uv); }
      for (let j2 = 1; j2 < P2.length; j2++) for (const dd of [0, 1]) if (per[dd]) { while (P2[j2]![dd]! - P2[j2 - 1]![dd]! > per[dd]! / 2) P2[j2]![dd]! -= per[dd]!; while (P2[j2]![dd]! - P2[j2 - 1]![dd]! < -per[dd]! / 2) P2[j2]![dd]! += per[dd]!; }
      const pc = curve2(oc, ss, P2, 5);
      { const mid = (f0 + f1) / 2; const ref = pc0.Value(Math.min(g0.LastParameter(), Math.max(g0.FirstParameter(), mid))); const mine = pc.Value(mid); const dx = per[0] ? per[0] * Math.round((ref.X() - mine.X()) / per[0]) : 0, dy = per[1] ? per[1] * Math.round((ref.Y() - mine.Y()) / per[1]) : 0; if (dx || dy) pc.Translate(new oc.gp_Vec2d(dx, dy)); }
      B.UpdateEdge(ed, pc, mf, Math.max(oc.BRep_Tool.Tolerance(ed), 1.5 * gap2));
      (info.pcurveRemade ??= []).push(+gap2.toExponential(2));
    }
    B.Range(ed, f0, f1, false);
  }
  // the round's wires, from its own (unoriented) face
  Folds.forEach((F, fi) => { for (const w of list(F.Oriented(FWD), WIRE)) {
    const W = new oc.TopoDS_Wire(); B.MakeWire(W);
    for (const e of list(w.Oriented(FWD), EDGE)) { const i = Fedges.findIndex((x) => x.IsSame(e)); B.Add(W, newOf[i].Oriented(flips[i] ? (e.Orientation() === FWD ? REV : FWD) : e.Orientation())); }
    B.Add(FnewFs[fi], W.Oriented(w.Orientation()));
  } });
  const shell = new oc.TopoDS_Shell(); B.MakeShell(shell);
  for (const f of faces) {
    { const fi = Folds.findIndex((x) => x.IsSame(f)); if (fi >= 0) { B.Add(shell, FnewFs[fi].Oriented(Folds[fi].Orientation())); continue; } }
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
  // a vertex only gains tolerance as it is updated (an earlier stretch may have widened it to reach an edge of OCCT's that this stretch has now made
  // exact): set those this round moved back to the least, and let them take again only what their edges need now
  { const fix = new oc.ShapeFix_ShapeTolerance(); for (const { V } of vertexKey) fix.SetTolerance(V, tol, VERT); oc.BRepLib.UpdateTolerances(solid, false); }
  info.residual = ex.residual; info.closed = closed;
  return { shape: solid, round: FnewF, rounds: FnewFs, info: { ...info, sup } };
  } finally { for (const P of keep) P.release(); }
}

/** Several edges of one tangent chain as one curve, parameter running along them in order (and on past both ends along the end edges' own curves). */
export function chainCurve(oc: any, edges: any[]) {
  const VERT = oc.TopAbs_ShapeEnum.TopAbs_VERTEX; const FWD = oc.TopAbs_Orientation.TopAbs_FORWARD;
  const ends = (e: any) => { const vs: any[] = []; for (const ex = new oc.TopExp_Explorer(e.Oriented(FWD), VERT, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) vs.push(ex.Current()); return [vs.find((v) => v.Orientation() === FWD), vs.find((v) => v.Orientation() !== FWD)]; };
  const left = [...edges]; const order: { e: any; rev: boolean }[] = [];
  // start at an edge whose start meets no other edge of the chain
  const shares = (v: any, not: any) => edges.some((x) => !x.IsSame(not) && ends(x).some((w) => w.IsSame(v)));
  let i0 = left.findIndex((e) => !shares(ends(e)[0], e)); let rev0 = false;
  if (i0 < 0) { i0 = left.findIndex((e) => !shares(ends(e)[1], e)); rev0 = true; } if (i0 < 0) { i0 = 0; rev0 = false; }
  order.push({ e: left.splice(i0, 1)[0], rev: rev0 });
  while (left.length) { const last = order[order.length - 1]!; const tail = ends(last.e)[last.rev ? 0 : 1]; const j = left.findIndex((e) => ends(e).some((w) => w.IsSame(tail))); if (j < 0) throw new Error('chain edges do not connect'); const e = left.splice(j, 1)[0]; order.push({ e, rev: !ends(e)[0].IsSame(tail) }); }
  const pieces = order.map(({ e, rev }) => { const c = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(e)); return { c, a: c.FirstParameter(), b: c.LastParameter(), rev }; });
  const cum = [0]; for (const p of pieces) cum.push(cum[cum.length - 1]! + (p.b - p.a));
  const total = cum[cum.length - 1]!;
  // a closed chain runs on round past its end (a section just before its start is on its last edge, not on the first edge's curve run backwards)
  const first = ends(order[0]!.e)[order[0]!.rev ? 1 : 0], last = ends(order[order.length - 1]!.e)[order[order.length - 1]!.rev ? 0 : 1];
  const closed = order.length > 1 && first.IsSame(last);
  const at = (T0: number) => { const T = closed ? T0 - total * Math.floor(T0 / total) : T0; let i = pieces.length - 1; for (let q = 0; q < pieces.length; q++) if (T < cum[q + 1]!) { i = q; break; } const p = pieces[i]!; const s = T - cum[i]!; return { p, t: p.rev ? p.b - s : p.a + s, sg: p.rev ? -1 : 1 }; };
  const make = (lo: number, hi: number): any => ({
    composite: true,
    FirstParameter: () => lo, LastParameter: () => hi,
    Value: (T: number) => { const { p, t } = at(T); return p.c.Value(t); },
    // point and tangent as JS arrays (see `cD1`, which calls it for a chain)
    d1: (T: number) => { const { p, t, sg } = at(T); const o = cD1(oc, p.c, t); return { p: o.p, d: mul(o.d, sg) }; },
    extended: (a: number, b: number) => make(a, b),
    order, cum, closedChain: closed,
  });
  return make(0, total);
}
