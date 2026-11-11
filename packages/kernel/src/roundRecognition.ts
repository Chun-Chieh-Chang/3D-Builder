/**
 * C2.8–C2.10: reading a round that is no simple surface (a B-spline in the file) back as a rolling ball, the sharp edge it took off, and that edge on a
 * rebuilt body, without taking the round off (`deleteFaces` cannot when the faces beside it are curved; design doc freeform-generalization §3).
 *
 * Every native object made here is deleted where it is read (the bindings' objects are not garbage collected), and derivatives are read through
 * `sD1` into reused outputs, not EvalD1 (C2.14d).
 */
import { sD1, supportOf } from './exactRound';

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const take = (p: { X(): number; Y(): number; Z(): number; delete(): void }): V3 => { const o: V3 = [p.X(), p.Y(), p.Z()]; p.delete(); return o; };

/** The radius of the circle through three points (Infinity when they are on a line). */
function circum(a: V3, b: V3, c: V3): number {
  const ab = len(sub(a, b)), bc = len(sub(b, c)), ca = len(sub(c, a));
  const area = len(cross(sub(b, a), sub(c, a))) / 2;
  return area > 1e-14 ? (ab * bc * ca) / (4 * area) : Infinity;
}

/**
 * Whether (u, v) is inside a face, by one classifier asked again and again. An exact round's surface runs past its face (an open one is built 4r longer at
 * each end), and there the supports may not be (a wall's curve ends at the wall's corner): what is measured must be on the face itself.
 */
function insideOf(oc: any, face: any) {
  const cl = new oc.BRepClass_FaceClassifier();
  const p = new oc.gp_Pnt2d(0, 0);
  const IN = oc.TopAbs_State.TopAbs_IN;
  return {
    at(u: number, v: number): boolean {
      // not SetCoord(u, v): the bindings choose its overload by the values, and a whole-number u is read as SetCoord(Index, Xi) — 0 throws
      // Standard_OutOfRange, 1 or 2 sets the wrong coordinate (measured)
      p.SetX(u);
      p.SetY(v);
      cl.Perform(face, p, 1e-9);
      const s = cl.State();
      return s === IN || String(s) === String(IN);
    },
    release() { cl.delete(); p.delete(); },
  };
}

/**
 * How far apart (relative) the section radii may be for a face to be asked whether it is a round at all. This only finds the arcs' direction and their
 * radius; whether the face is a rolling ball is decided by `rollingBall`'s deviation, and whether a rebuild stands by the recognition tolerance.
 * A radius through three points magnifies a small error of the surface: measured on part-4's rounds 1e-11 to 2.4e-6 (r = 0.4572 at 2.0e-6 and 2.4e-6,
 * ball deviation within C2.4's 1.45e-6), and on the fuzz's arcs of other directions 3e-2 and more. A first gate of 1e-6, set without that measurement,
 * refused real rounds.
 */
const ARC_SPREAD = 1e-3;

/**
 * When a face's lines of one parameter are arcs of one circle size (each read through four points at nine places along the other parameter, the radii
 * within ARC_SPREAD of each other, relative): their mean radius, and the parameter the arcs run along. Else null.
 */
export function arcSections(oc: any, face: any): { radius: number; across: 'u' | 'v' } | null {
  const ad = new oc.BRepAdaptor_Surface(face, true);
  try {
    const u0 = ad.FirstUParameter(), u1 = ad.LastUParameter(), v0 = ad.FirstVParameter(), v1 = ad.LastVParameter();
    if (![u0, u1, v0, v1].every(Number.isFinite)) return null;
    const P = (u: number, v: number) => take(ad.Value(u, v));
    for (const across of ['v', 'u'] as const) {
      const rs: number[] = [];
      for (let s = 0; s <= 8; s++) {
        const t = s / 8;
        const q = [0, 0.37, 0.71, 1].map((w) => (across === 'v' ? P(u0 + (u1 - u0) * t, v0 + (v1 - v0) * w) : P(u0 + (u1 - u0) * w, v0 + (v1 - v0) * t)));
        rs.push(circum(q[0]!, q[1]!, q[2]!), circum(q[1]!, q[2]!, q[3]!));
      }
      const m = rs.reduce((a, b) => a + b, 0) / rs.length;
      if (Number.isFinite(m) && Math.max(...rs) - Math.min(...rs) <= ARC_SPREAD * m) return { radius: m, across };
    }
    return null;
  } finally {
    ad.delete();
  }
}

/**
 * Whether `face` is a rolling-ball round of one radius between faces `a` and `b`: its sections are arcs of one radius r, and from every sampled point
 * the centre r along the normal, on one side for the whole face, is r from both supports (their surfaces, not only the trimmed faces) to within `tol`.
 * `convex`: the centre is inside the material (a round on an outside edge). Else null.
 */
export function rollingBall(oc: any, face: any, a: any, b: any, tol: number): { radius: number; convex: boolean; deviation: number } | null {
  const arc = arcSections(oc, face);
  if (!arc) return null;
  const r = arc.radius;
  const sup = [supportOf(oc, a), supportOf(oc, b)];
  const ad = new oc.BRepAdaptor_Surface(face, true);
  const inside = insideOf(oc, face);
  try {
    const out = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1;
    const u0 = ad.FirstUParameter(), u1 = ad.LastUParameter(), v0 = ad.FirstVParameter(), v1 = ad.LastVParameter();
    // the centre off the outward normal by -r (inside: convex) or +r (outside: concave), its worst distance error over the face
    const worst = [0, 0];
    let seen = 0;
    for (let i = 0; i <= 24; i++) for (let j = 1; j < 8; j++) {
      const [u, v] = [u0 + ((u1 - u0) * i) / 24, v0 + ((v1 - v0) * j) / 8];
      if (!inside.at(u, v)) continue;
      seen++;
      const d = sD1(oc, ad, u, v);
      const n = cross(d.du, d.dv);
      const l = len(n);
      if (!(l > 0)) return null;
      const nOut: V3 = [(out * n[0]) / l, (out * n[1]) / l, (out * n[2]) / l];
      [-1, 1].forEach((sg, k) => {
        const c: V3 = [d.p[0] + sg * r * nOut[0], d.p[1] + sg * r * nOut[1], d.p[2] + sg * r * nOut[2]];
        worst[k] = Math.max(worst[k]!, ...sup.map((S) => Math.abs(S.dist(c) - r)));
      });
    }
    // too few points on the face to say (a sliver): not read as a round
    if (seen < 20) return null;
    const k = worst[0]! <= worst[1]! ? 0 : 1;
    const deviation = worst[k]!;
    return deviation <= tol ? { radius: r, convex: k === 0, deviation } : null;
  } finally {
    inside.release();
    ad.delete();
    for (const S of sup) S.release();
  }
}

/** Points along a curve: a projector set up once on its range and asked for each point (a new one per point on a B-spline keeps heap, see `projector`). */
function curveProjector(oc: any, curve: any, t0: number, t1: number) {
  const pr = new oc.GeomAPI_ProjectPointOnCurve();
  pr.Init(curve, t0, t1);
  const g = new oc.gp_Pnt();
  return {
    run(p: V3): { t: number; d: number } | null {
      g.SetCoord(p[0], p[1], p[2]);
      pr.Perform(g);
      return pr.NbPoints() > 0 ? { t: pr.LowerDistanceParameter(), d: pr.LowerDistance() } : null;
    },
    release() { pr.delete(); g.delete(); },
  };
}

/**
 * C2.8: the sharp edge a round between faces `a` and `b` took off, without taking it off: the two faces' surfaces (whole, not trimmed) intersected, the
 * branch nearest the round, sampled at `n` points between where the round's first and last sections are (2% in from each end, so that every point is
 * inside the edge a rebuilt body has there). The whole branch when the round goes all the way round. Null when the surfaces do not meet near it.
 */
export function sharpCurve(oc: any, round: any, a: any, b: any, n = 33): { points: V3[]; closed: boolean } | null {
  const arc = arcSections(oc, round);
  if (!arc) return null;
  const ad = new oc.BRepAdaptor_Surface(round, true);
  const SA = oc.BRep_Tool.Surface(a);
  const SB = oc.BRep_Tool.Surface(b);
  const ii = new oc.GeomAPI_IntSS(SA, SB, 1e-9);
  try {
    if (!ii.IsDone() || ii.NbLines() === 0) return null;
    const u0 = ad.FirstUParameter(), u1 = ad.LastUParameter(), v0 = ad.FirstVParameter(), v1 = ad.LastVParameter();
    // along the round (the parameter its arcs are not), at the middle of each arc
    const at = (s: number): V3 => take(arc.across === 'v' ? ad.Value(u0 + (u1 - u0) * s, (v0 + v1) / 2) : ad.Value((u0 + u1) / 2, v0 + (v1 - v0) * s));
    const [first, mid, last] = [at(0), at(0.5), at(1)];
    const closed = len(sub(first, last)) <= 1e-7;
    let best: { curve: any; t0: number; t1: number; d: number } | null = null;
    for (let i = 1; i <= ii.NbLines(); i++) {
      const line = ii.Line(i);
      const curve = line.get ? line.get() : line;
      const t0 = curve.FirstParameter(), t1 = curve.LastParameter();
      const pr = curveProjector(oc, curve, t0, t1);
      try {
        const m = pr.run(mid);
        if (m && (!best || m.d < best.d)) best = { curve, t0, t1, d: m.d };
      } finally {
        pr.release();
      }
    }
    // the edge is about r(√2 − 1) from the middle of a round's arc for a right angle, more for a sharper one; three radii is far past any real round
    if (!best || best.d > 3 * arc.radius) return null;
    const { curve } = best;
    let [ta, tb] = [best.t0, best.t1];
    if (!closed) {
      // where the face itself is along its middle line (its surface runs past it), 2% of that in from each end
      const inside = insideOf(oc, round);
      let lo = Infinity, hi = -Infinity;
      try {
        for (let k = 0; k <= 400; k++) {
          const s = k / 400;
          const [u, v] = arc.across === 'v' ? [u0 + (u1 - u0) * s, (v0 + v1) / 2] : [(u0 + u1) / 2, v0 + (v1 - v0) * s];
          if (inside.at(u, v)) [lo, hi] = [Math.min(lo, s), Math.max(hi, s)];
        }
      } finally {
        inside.release();
      }
      if (!(hi > lo)) return null;
      const pr = curveProjector(oc, curve, best.t0, best.t1);
      try {
        const e0 = pr.run(at(lo + 0.02 * (hi - lo)));
        const e1 = pr.run(at(hi - 0.02 * (hi - lo)));
        if (!e0 || !e1) return null;
        [ta, tb] = e0.t <= e1.t ? [e0.t, e1.t] : [e1.t, e0.t];
      } finally {
        pr.release();
      }
    }
    const points: V3[] = [];
    // all the way round: the middles of n equal steps, none on the seam (where a rebuilt edge starts and ends, so a point there has no foot inside it)
    for (let k = 0; k < n; k++) points.push(take(curve.Value(ta + ((tb - ta) * (closed ? k + 0.5 : k)) / (closed ? n : n - 1))));
    // the intersection curve is OCCT's approximation (measured up to 6.9e-6 off a spline wall, on a plate's plane exactly): each point is put on both
    // surfaces exactly, or the edge is not given
    const exact = onBoth(oc, a, b, points);
    return exact ? { points: exact, closed } : null;
  } finally {
    ii.delete();
    ad.delete();
    SA.delete();
    SB.delete();
  }
}

/** x for J·x = F (4×4, partial pivoting), or null when J is singular. */
function solve4(J: number[][], F: number[]): number[] | null {
  const M = J.map((row, i) => [...row, F[i]!]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (!(Math.abs(M[p]![c]!) > 1e-300)) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = c + 1; r < 4; r++) {
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k < 5; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  const x = [0, 0, 0, 0];
  for (let r = 3; r >= 0; r--) {
    let s = M[r]![4]!;
    for (let k = r + 1; k < 4; k++) s -= M[r]![k]! * x[k]!;
    x[r] = s / M[r]![r]!;
  }
  return x;
}

/**
 * Each point moved onto the true intersection of faces `a` and `b` (their surfaces): Newton on both surfaces' parameters, A(ua, va) = B(ub, vb) and the
 * point in the plane through the start square to the intersection there. Null when any point does not reach both surfaces to 1e-12 (the surfaces
 * tangent there, or no intersection near it): not a sharp edge to be given.
 */
function onBoth(oc: any, a: any, b: any, points: readonly V3[]): V3[] | null {
  const A = supportOf(oc, a), B = supportOf(oc, b);
  try {
    const out: V3[] = [];
    for (const x0 of points) {
      let [ua, va] = A.proj(x0), [ub, vb] = B.proj(x0);
      const s0 = A.ev(ua, va), t0 = B.ev(ub, vb);
      const T = cross(s0.n, t0.n);
      const lt = len(T);
      if (!(lt > 1e-9)) return null;
      const tn: V3 = [T[0] / lt, T[1] / lt, T[2] / lt];
      let done: V3 | null = null;
      for (let it = 0; it < 30 && !done; it++) {
        const ea = A.ev(ua, va), eb = B.ev(ub, vb);
        const g = sub(ea.p, eb.p);
        const h = (ea.p[0] - x0[0]) * tn[0] + (ea.p[1] - x0[1]) * tn[1] + (ea.p[2] - x0[2]) * tn[2];
        if (len(g) <= 1e-12 && Math.abs(h) <= 1e-12) { done = ea.p; break; }
        const J = [0, 1, 2].map((k) => [ea.du[k]!, ea.dv[k]!, -eb.du[k]!, -eb.dv[k]!]);
        J.push([tn[0] * ea.du[0] + tn[1] * ea.du[1] + tn[2] * ea.du[2], tn[0] * ea.dv[0] + tn[1] * ea.dv[1] + tn[2] * ea.dv[2], 0, 0]);
        const d = solve4(J, [g[0], g[1], g[2], h]);
        if (!d) return null;
        [ua, va, ub, vb] = [ua - d[0]!, va - d[1]!, ub - d[2]!, vb - d[3]!];
      }
      if (!done) return null;
      out.push(done);
    }
    return out;
  } finally {
    A.release();
    B.release();
  }
}

/**
 * C2.10: for each point, how far it is from an edge, or null when its foot on the edge's curve is at an end (the point is past the edge).
 *
 * The distance is to the edge's faces' surfaces (the larger of them), not to the edge's curve: an edge where two faces meet in no simple curve carries
 * OCCT's approximation of it, off the faces by up to its tolerance (measured 1.3e-5 on a spline wall on a plate, tolerance 1.9e-5), and two bodies
 * built alike carry different approximations of the same edge. The surfaces are what the solid is. Each foot on a face starts from the edge's curve on
 * that face at the point's foot on the edge, and is refined by Newton (no global search). With no face given, the distance to the curve.
 */
export function distancesToEdge(oc: any, edge: any, points: readonly V3[], faces: readonly any[] = []): (number | null)[] {
  if (oc.BRep_Tool.Degenerated(edge)) return points.map(() => null);
  const ad = new oc.BRepAdaptor_Curve(edge);
  const t0 = ad.FirstParameter(), t1 = ad.LastParameter();
  const got = oc.BRep_Tool.Curve(edge, 0, 0);
  const curve = got?.returnValue ?? got;
  if (!curve || (typeof curve.IsNull === 'function' && curve.IsNull())) {
    ad.delete();
    return points.map(() => null);
  }
  // the curve the tool hands back has the edge's place applied; its range is the edge's own
  const pr = curveProjector(oc, curve, t0, t1);
  const on = faces.map((f) => ({ S: supportOf(oc, f), pc: new oc.BRepAdaptor_Curve2d(edge, f) }));
  const uv = new oc.gp_Pnt2d(0, 0);
  try {
    return points.map((p) => {
      const q = pr.run(p);
      if (!q) return null;
      // a foot at an end is no perpendicular one: the point is past the edge
      const span = Math.abs(t1 - t0);
      if (q.t <= Math.min(t0, t1) + 1e-9 * span || q.t >= Math.max(t0, t1) - 1e-9 * span) return null;
      if (on.length === 0) return q.d;
      return Math.max(...on.map(({ S, pc }) => {
        pc.D0(q.t, uv);
        return S.foot(p, [uv.X(), uv.Y()]);
      }));
    });
  } finally {
    pr.release();
    for (const { S, pc } of on) {
      S.release();
      pc.delete();
    }
    uv.delete();
    ad.delete();
    curve.delete?.();
  }
}
