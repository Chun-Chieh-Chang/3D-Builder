// C2.7 prototype library: exact rolling-ball round surface between two support faces.
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

export interface Support { ev(u: number, v: number): { p: V3; n: V3 }; proj(q: V3): [number, number]; dist(q: V3): number }

export function supportOf(oc: any, face: any): Support {
  const ad = new oc.BRepAdaptor_Surface(face, true); const S = oc.BRep_Tool.Surface(face);
  const flip = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1;
  const ev = (u: number, v: number) => { const d = ad.EvalD1(u, v); const p: V3 = [d.Point.X(), d.Point.Y(), d.Point.Z()]; const n = unit(cross([d.D1U.X(), d.D1U.Y(), d.D1U.Z()], [d.D1V.X(), d.D1V.Y(), d.D1V.Z()])); return { p, n: mul(n, flip) }; };
  const proj = (q: V3) => { const pr = new oc.GeomAPI_ProjectPointOnSurf(new oc.gp_Pnt(q[0], q[1], q[2]), S); const uv = pr.LowerDistanceParameters(0, 0); return [uv.U ?? uv.u ?? uv[0], uv.V ?? uv.v ?? uv[1]] as [number, number]; };
  const dist = (q: V3) => new oc.GeomAPI_ProjectPointOnSurf(new oc.gp_Pnt(q[0], q[1], q[2]), S).LowerDistance();
  return { ev, proj, dist };
}

/**
 * The exact round of radius r along the sharp edge E (a BRepAdaptor_Curve) between supports a (v = 0) and b (v = 1); sgn +1 when the ball is on the
 * side the supports' normals point to. Returns the OCCT surface and its u range (chord length of the center curve).
 */
export function exactRound(oc: any, a: Support, b: Support, ca: any, r: number, sgn: number, NS = 200, P = 5, tStart?: number, pin?: { index: number; value: number; period: number }) {
  const tf = ca.FirstParameter(), t1f = ca.LastParameter(); let t0 = tStart ?? tf, t1 = t0 + (t1f - tf); let pinned: number | null = null;
  const E = (tt: number) => { const d = ca.EvalD1(tt); return { p: [d.Point.X(), d.Point.Y(), d.Point.Z()] as V3, d: [d.D1.X(), d.D1.Y(), d.D1.Z()] as V3 }; };
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
    for (let it = 0; it < 30; it++) {
      const nf = Math.hypot(...out.f); if (nf < 1e-14) break;
      const h = 1e-7; const J: number[][] = [[], [], [], []];
      for (let j = 0; j < 4; j++) { const xp = [...x]; xp[j]! += h; const xm = [...x]; xm[j]! -= h; const fp = F(xp, tt).f, fm = F(xm, tt).f; for (let q = 0; q < 4; q++) J[q]![j] = (fp[q]! - fm[q]!) / (2 * h); }
      const dx = solve(J, out.f.map((v) => [v])).map((v) => v[0]!);
      let lam = 1; let nx = x.map((v, q) => v - lam * dx[q]!); let no = F(nx, tt);
      while (Math.hypot(...no.f) > nf && lam > 1e-4) { lam /= 2; nx = x.map((v, q) => v - lam * dx[q]!); no = F(nx, tt); }
      x = nx; out = no;
    }
    return { x, out };
  };
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
    const { U: U2, poles: P2 } = interpolate(sp, pts, P);
    const arr2 = new oc.NCollection_Array1_gp_Pnt2d(1, P2.length); P2.forEach((q, i) => arr2.SetValue(i + 1, new oc.gp_Pnt2d(q[0], q[1])));
    return new oc.Geom2d_BSplineCurve(arr2, UK, UM, P, false);
  };
  return { surf, pcurve, t0, u0: sp[0]!, u1: sp[sp.length - 1]!, residual, closed: len(sub(samples[0]!.c, samples[samples.length - 1]!.c)) < 1e-9 };
}

/** Largest rolling-ball deviation of a face (sampled inside its parameter box) from radius r on the given supports. */
export function deviation(oc: any, face: any, sup: Support[], r: number, n = 40) {
  const ad = new oc.BRepAdaptor_Surface(face, true);
  const u0 = ad.FirstUParameter(), u1 = ad.LastUParameter(), v0 = ad.FirstVParameter(), v1 = ad.LastVParameter();
  let dev = 0;
  for (let i = 0; i <= n; i++) for (let j = 1; j < 8; j++) {
    const d = ad.EvalD1(u0 + ((u1 - u0) * i) / n, v0 + ((v1 - v0) * j) / 8); const p: V3 = [d.Point.X(), d.Point.Y(), d.Point.Z()];
    const nn = unit(cross([d.D1U.X(), d.D1U.Y(), d.D1U.Z()], [d.D1V.X(), d.D1V.Y(), d.D1V.Z()]));
    let best = Infinity; for (const sg of [1, -1]) { const c = add(p, mul(nn, sg * r)); best = Math.min(best, Math.max(...sup.map((S) => Math.abs(S.dist(c) - r)))); }
    dev = Math.max(dev, best);
  }
  return dev;
}
