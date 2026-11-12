// C2.7 prototype: an exact rolling-ball round between two support surfaces.
// Center curve c(t) solved by Newton (c = P1 + r n1 = P2 + r n2, (c - E(t))·E'(t) = 0), characteristic arcs P1→P2 about c,
// surface rational (quadratic in v, cubic interpolation in u of homogeneous rows). Measured with the same rolling-ball deviation as rollball.test.ts.
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => mul(a, 1 / len(a));

/** Solve the dense linear system A x = b (Gaussian elimination, partial pivoting); b may hold several right-hand sides as columns. */
function solve(A: number[][], B: number[][]): number[][] {
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

/** Cox–de Boor basis values of degree p at u for the knot vector U (all n = U.length - p - 1 functions). */
function basis(U: number[], p: number, u: number): number[] {
  const n = U.length - p - 1; const N = new Array(U.length - 1).fill(0);
  for (let i = 0; i < U.length - 1; i++) N[i] = (u >= U[i]! && u < U[i + 1]!) || (u === U[U.length - 1] && i === n - 1 && U[i]! < U[i + 1]!) ? 1 : 0;
  for (let k = 1; k <= p; k++) for (let i = 0; i < U.length - 1 - k; i++) {
    const l = U[i + k]! - U[i]! > 0 ? ((u - U[i]!) / (U[i + k]! - U[i]!)) * N[i]! : 0;
    const r = U[i + k + 1]! - U[i + 1]! > 0 ? ((U[i + k + 1]! - u) / (U[i + k + 1]! - U[i + 1]!)) * N[i + 1]! : 0;
    N[i] = l + r;
  }
  return N.slice(0, n);
}

/** Global interpolation (degree p, clamped, knots by averaging) of rows of numbers at the parameters s. */
function interpolate(s: number[], rows: number[][], p: number) {
  const n = s.length; const U: number[] = [];
  for (let i = 0; i <= p; i++) U.push(s[0]!);
  for (let j = 1; j < n - p; j++) { let a = 0; for (let i = j; i < j + p; i++) a += s[i]!; U.push(a / p); }
  for (let i = 0; i <= p; i++) U.push(s[n - 1]!);
  const A = s.map((u) => basis(U, p, u));
  return { U, poles: solve(A, rows) };
}

it('exact rolling-ball round', async () => {
  const kernel = await Kernel.load();
  const k = kernel as any; const oc = k.oc;
  const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as any;
  const sq = (w: number) => ({ outer: [[-w, -w], [w, -w], [w, w], [-w, w]].map((a, i, p) => ({ kind: 'line', a, b: p[(i + 1) % 4], source: 'b' + i })), holes: [] }) as any;
  const res: any = {};
  const tilt = 0.25, draft = 5;
  const plate = kernel.extrude(XY, [sq(20)], [0, 0, 5]).shape;
  const frame = { origin: [0, 0, 5], xDir: [1, 0, 0], yDir: [0, Math.cos(tilt), Math.sin(tilt)], normal: [0, -Math.sin(tilt), Math.cos(tilt)] } as any;
  const boss = kernel.extrude({ ...frame, origin: [0, -2 * Math.sin(tilt), 5 - 2 * Math.cos(tilt)] }, [{ outer: [{ kind: 'circle', c: [0, 0], r: 6, source: 'c' }], holes: [] }], frame.normal.map((x: number) => x * 12), 0, undefined, (draft * Math.PI) / 180).shape;
  const s = kernel.boolean('fuse', plate, boss).shape;
  const t = kernel.topology(s);
  const top = t.faces.findIndex((f: any) => f.geometry?.type === 'plane' && Math.abs(f.geometry.normal[2] - 1) < 1e-9 && Math.abs(f.center[2] - 5) < 1e-6);
  const side = t.faces.findIndex((f: any) => f.geometry?.type === 'cone' || f.geometry?.type === 'cylinder');
  const shp = k.get(s);
  const faces: any[] = []; for (const ex = new oc.TopExp_Explorer(shp, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
  const edgeIdx = t.edges.findIndex((e: any) => e.faces.includes(top) && e.faces.includes(side));
  let edge: any = null; { let i = 0; for (const ex = new oc.TopExp_Explorer(shp, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) { const m = t.edges[edgeIdx].mid; const ed = oc.TopoDS.Edge(ex.Current()); const ad = new oc.BRepAdaptor_Curve(ed); const pm = ad.Value((ad.FirstParameter() + ad.LastParameter()) / 2); if (Math.hypot(pm.X() - m[0], pm.Y() - m[1], pm.Z() - m[2]) < 1e-6) { edge = ed; break; } i++; } }
  const supports = [top, side].map((fi) => {
    const f = faces[fi]; const ad = new oc.BRepAdaptor_Surface(f, true); const S = oc.BRep_Tool.Surface(f);
    const flip = f.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1;
    const ev = (u: number, v: number) => { const d = ad.EvalD1(u, v); const p: V3 = [d.Point.X(), d.Point.Y(), d.Point.Z()]; const n = unit(cross([d.D1U.X(), d.D1U.Y(), d.D1U.Z()], [d.D1V.X(), d.D1V.Y(), d.D1V.Z()])); return { p, n: mul(n, flip) }; };
    const proj = (q: V3) => { const pr = new oc.GeomAPI_ProjectPointOnSurf(new oc.gp_Pnt(q[0], q[1], q[2]), S); const uv = pr.LowerDistanceParameters(0, 0); return [uv.U ?? uv.u ?? uv[0], uv.V ?? uv.v ?? uv[1]] as [number, number]; };
    const dist = (q: V3) => { const pr = new oc.GeomAPI_ProjectPointOnSurf(new oc.gp_Pnt(q[0], q[1], q[2]), S); return pr.LowerDistance(); };
    return { ev, proj, dist };
  });
  const ca = new oc.BRepAdaptor_Curve(edge); const t0 = ca.FirstParameter(), t1 = ca.LastParameter();
  const E = (tt: number) => { const d = ca.EvalD1(tt); return { p: [d.Point.X(), d.Point.Y(), d.Point.Z()] as V3, d: [d.D1.X(), d.D1.Y(), d.D1.Z()] as V3 }; };

  for (const r of [0.381, 1.5]) {
    // the side of each face the ball is on: concave edge here, outside both
    const sgn = 1;
    const F = (x: number[], tt: number) => {
      const a = supports[0]!.ev(x[0]!, x[1]!), b = supports[1]!.ev(x[2]!, x[3]!);
      const c1 = add(a.p, mul(a.n, sgn * r)), c2 = add(b.p, mul(b.n, sgn * r));
      const e = E(tt); const mid = mul(add(c1, c2), 0.5);
      return { f: [c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2], dot(sub(mid, e.p), e.d) / len(e.d)], c: mid, p1: a.p, p2: b.p };
    };
    const samples: { c: V3; p1: V3; p2: V3; x: number[] }[] = [];
    const NS = Number(process.env.NS ?? 200);
    let worstF = 0, iters = 0;
    let prev: number[] | null = null;
    for (let i = 0; i <= NS; i++) {
      const tt = t0 + ((t1 - t0) * i) / NS;
      let x: number[];
      if (prev) x = [...prev];
      else {
        const e = E(tt).p; const uv1 = supports[0]!.proj(e), uv2 = supports[1]!.proj(e);
        const n1 = supports[0]!.ev(...uv1).n, n2 = supports[1]!.ev(...uv2).n;
        const cg = add(e, mul(add(n1, n2), (sgn * r) / (1 + dot(n1, n2))));
        x = [...supports[0]!.proj(cg), ...supports[1]!.proj(cg)];
      }
      let out = F(x, tt);
      for (let it = 0; it < 30; it++) {
        const nf = Math.hypot(...out.f); if (nf < 1e-14) break;
        const h = 1e-7; const J: number[][] = [[], [], [], []];
        for (let j = 0; j < 4; j++) { const xp = [...x]; xp[j]! += h; const xm = [...x]; xm[j]! -= h; const fp = F(xp, tt).f, fm = F(xm, tt).f; for (let q = 0; q < 4; q++) J[q]![j] = (fp[q]! - fm[q]!) / (2 * h); }
        const dx = solve(J, out.f.map((v) => [v])).map((v) => v[0]!);
        let lam = 1; let nx = x.map((v, q) => v - lam * dx[q]!); let no = F(nx, tt);
        while (Math.hypot(...no.f) > nf && lam > 1e-4) { lam /= 2; nx = x.map((v, q) => v - lam * dx[q]!); no = F(nx, tt); }
        x = nx; out = no; iters++;
      }
      worstF = Math.max(worstF, Math.hypot(...out.f));
      prev = x;
      samples.push({ c: out.c, p1: out.p1, p2: out.p2, x });
    }
    // rows: P1, w*M, P2 and w, at chord-length parameters of the center curve
    const sp = [0]; for (let i = 1; i < samples.length; i++) sp.push(sp[i - 1]! + len(sub(samples[i]!.c, samples[i - 1]!.c)));
    const rows = samples.map(({ c, p1, p2 }) => {
      const a = sub(p1, c), b = sub(p2, c); const th = Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b)))));
      const w = Math.cos(th / 2); const M = add(c, mul(unit(add(unit(a), unit(b))), r / w));
      return [...p1, ...mul(M, w), w, ...p2];
    });
    const P = Number(process.env.DEG ?? 3);
    const { U, poles } = interpolate(sp, rows, P);
    const nu = poles.length;
    const arr = new oc.NCollection_Array2_gp_Pnt(1, nu, 1, 3); const wts = new oc.NCollection_Array2_double(1, nu, 1, 3);
    poles.forEach((row, i) => { const w = row[6]!; arr.SetValue(i + 1, 1, new oc.gp_Pnt(row[0], row[1], row[2])); arr.SetValue(i + 1, 2, new oc.gp_Pnt(row[3]! / w, row[4]! / w, row[5]! / w)); arr.SetValue(i + 1, 3, new oc.gp_Pnt(row[7], row[8], row[9])); wts.SetValue(i + 1, 1, 1); wts.SetValue(i + 1, 2, w); wts.SetValue(i + 1, 3, 1); });
    const ku: number[] = [], mu: number[] = []; for (const u of U) { if (ku.length && Math.abs(ku[ku.length - 1]! - u) < 1e-15) mu[mu.length - 1]!++; else { ku.push(u); mu.push(1); } }
    const UK = new oc.NCollection_Array1_double(1, ku.length), UM = new oc.NCollection_Array1_int(1, mu.length); ku.forEach((u, i) => UK.SetValue(i + 1, u)); mu.forEach((m, i) => UM.SetValue(i + 1, m));
    const VK = new oc.NCollection_Array1_double(1, 2), VM = new oc.NCollection_Array1_int(1, 2); VK.SetValue(1, 0); VK.SetValue(2, 1); VM.SetValue(1, 3); VM.SetValue(2, 3);
    const surf = new oc.Geom_BSplineSurface(arr, wts, UK, VK, UM, VM, P, 2, false, false);
    const ga = new oc.GeomAdaptor_Surface(surf);
    // deviation of the built surface from the rolling ball, between and at the samples
    let dev = 0, contact = 0;
    const NU = Number(process.env.NU ?? 997);
    for (let i = 0; i <= NU; i++) {
      const u = sp[0]! + ((sp[sp.length - 1]! - sp[0]!) * i) / NU;
      for (const v of [0, 0.13, 0.37, 0.5, 0.71, 0.93, 1]) {
        const d = ga.EvalD1(u, v); const p: V3 = [d.Point.X(), d.Point.Y(), d.Point.Z()];
        const n = unit(cross([d.D1U.X(), d.D1U.Y(), d.D1U.Z()], [d.D1V.X(), d.D1V.Y(), d.D1V.Z()]));
        let best = Infinity; for (const sg of [1, -1]) { const c = add(p, mul(n, sg * r)); const m = Math.max(...supports.map((S) => Math.abs(S.dist(c) - r))); best = Math.min(best, m); }
        dev = Math.max(dev, best);
        if (v === 0) contact = Math.max(contact, supports[0]!.dist(p)); if (v === 1) contact = Math.max(contact, supports[1]!.dist(p));
      }
    }
    res[`r=${r}`] = { NS, degree: P, newtonResidual: worstF, newtonIters: iters, poles: nu, maxDeviation: dev, maxContactOff: contact };
  }
  writeFileSync(process.env.OUT ?? 'exactball.json', JSON.stringify(res, null, 1));
}, 600000);
