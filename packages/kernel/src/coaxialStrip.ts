/**
 * ADR 0258: a ruled B-spline face between two coaxial circle arcs is a strip of a cone (or of a cylinder, when the radii are the same). OCCT's
 * `GeomConvert_SurfToAnaSurf` misses such strips when they are narrow (E13 f71: a 5° strip of a 0.8727° cone, null at every tolerance up to 1e-4,
 * a cylinder with a tilted axis at 1e-3). This module holds the arithmetic: a circle fitted to the points of a rail, and the cone or cylinder two
 * fitted rails imply. Every gate is a length compared with the caller's `tol`; whether the face is that surface is measured by the caller over the
 * face (`Kernel.analyticFace`), not assumed from the rails.
 */
import type { SurfaceGeometry, Vec3 } from './types';

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** The solution of the 3 × 3 system `m · x = r` (Gaussian elimination, partial pivoting); null when it is singular. */
function solve3(m: number[][], r: number[]): [number, number, number] | null {
  const a = m.map((row, i) => [...row, r[i]!]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let i = c + 1; i < 3; i++) if (Math.abs(a[i]![c]!) > Math.abs(a[p]![c]!)) p = i;
    if (!(Math.abs(a[p]![c]!) > 0)) return null;
    [a[c], a[p]] = [a[p]!, a[c]!];
    for (let i = c + 1; i < 3; i++) {
      const f = a[i]![c]! / a[c]![c]!;
      for (let j = c; j < 4; j++) a[i]![j]! -= f * a[c]![j]!;
    }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let s = a[i]![3]!;
    for (let j = i + 1; j < 3; j++) s -= a[i]![j]! * x[j]!;
    x[i] = s / a[i]![i]!;
  }
  return x.every(Number.isFinite) ? (x as [number, number, number]) : null;
}

export interface ArcFit {
  centre: Vec3;
  /** The unit normal of the rail's plane. */
  normal: Vec3;
  radius: number;
  /** The largest distance of a point from the fitted circle, in the plane (mm). */
  residual: number;
  /** The largest distance of a point from the plane (mm). */
  flat: number;
  /** The largest distance of a point from the line through the first point and the point farthest from it: how far the rail is from straight (mm). */
  bow: number;
}

/**
 * The circle through `points` (at least 5, in order along a rail) by least squares (Kåsa's algebraic fit, in the rail's plane about the points'
 * centroid, in units of the rail's span). Not the circle through three of them, which rests on three points' last digits. A geometric refinement
 * (Gauss–Newton on the distances) was measured and dropped: on 1°–7° arcs with noise of 1e-7 to 5e-6 it left the same residual and moved the radius
 * by under 1e-6 of it (probe c13n); the gates downstream measure what the rail shows, not the centre. Null when the points are on one line.
 */
export function fitArc(points: Vec3[]): ArcFit | null {
  if (points.length < 5) return null;
  const p0 = points[0]!;
  // the basis from the rail itself, so that a full circle (first point = last point) is no special case
  let far = p0;
  for (const p of points) if (len(sub(p, p0)) > len(sub(far, p0))) far = p;
  const L = len(sub(far, p0));
  if (!(L > 0)) return null;
  const e1 = mul(sub(far, p0), 1 / L);
  let side = p0;
  let bow = 0;
  for (const p of points) {
    const w = sub(p, p0);
    const d = len(sub(w, mul(e1, dot(w, e1))));
    if (d > bow) [bow, side] = [d, p];
  }
  const nn = cross(sub(far, p0), sub(side, p0));
  if (!(len(nn) > 0)) return null;
  const normal = mul(nn, 1 / len(nn));
  const e2 = cross(normal, e1);
  const m = mul(points.reduce<Vec3>((s, p) => add(s, p), [0, 0, 0]), 1 / points.length);
  const flat = Math.max(...points.map((p) => Math.abs(dot(sub(p, m), normal))));
  // plane coordinates about the centroid, in units of L
  const xy = points.map((p) => [dot(sub(p, m), e1) / L, dot(sub(p, m), e2) / L] as const);
  // Kåsa: x² + y² + D x + E y + F = 0
  const N: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const R = [0, 0, 0];
  for (const [x, y] of xy) {
    const row = [x, y, 1];
    const z = -(x * x + y * y);
    for (let i = 0; i < 3; i++) {
      R[i]! += row[i]! * z;
      for (let j = 0; j < 3; j++) N[i]![j]! += row[i]! * row[j]!;
    }
  }
  const k = solve3(N, R);
  if (!k) return null;
  const [cx, cy] = [-k[0] / 2, -k[1] / 2];
  const r = Math.sqrt(cx * cx + cy * cy - k[2]);
  if (![cx, cy, r].every(Number.isFinite) || !(r > 0)) return null;
  const centre = add(m, add(mul(e1, cx * L), mul(e2, cy * L)));
  const radius = r * L;
  let residual = 0;
  for (const p of points) {
    const w = sub(p, centre);
    residual = Math.max(residual, Math.abs(len(sub(w, mul(normal, dot(w, normal)))) - radius));
  }
  return { centre, normal, radius, residual, flat, bow };
}

/** Why two rails are not the ends of a cone or cylinder strip, for the counts of the fuzz test; or the axis they share. */
export type CoaxialRails =
  | { ok: false; reason: 'not-an-arc' | 'not-flat' | 'not-a-circle' | 'straight' | 'planes-not-parallel' | 'one-plane' | 'not-coaxial' }
  | {
      ok: true;
      /** A point of the axis, on rail `a`'s plane. */
      origin: Vec3;
      /** The unit axis, from rail `a`'s plane toward rail `b`'s. */
      axis: Vec3;
      ra: number;
      rb: number;
      /** How far apart the planes are along the axis (> tol). */
      height: number;
    };

/** Half the range of `xs` and its middle. */
function band(xs: number[]): { half: number; mid: number } {
  const [lo, hi] = [Math.min(...xs), Math.max(...xs)];
  return { half: (hi - lo) / 2, mid: (hi + lo) / 2 };
}

/**
 * Whether rails `a` and `b` (points along each, from the two ends of a ruled surface) are circle arcs on one axis, to within `tol` mm at every gate.
 * Each rail: flat, on its fitted circle, and bowed by more than `tol` (a rail within `tol` of a straight line has no radius to speak of). Then the
 * shared axis — square to both planes (their normals averaged), through the middle of the two centres — and, for each rail, what the surface shows of
 * it: every point at one height along that axis ('planes-not-parallel') and at one distance from it ('not-coaxial'), to within `tol`. Not the distance
 * between the centres: on a narrow arc a centre is poorly fixed along the arc's middle radius (E13 f71, 5°: the file's 9-digit poles put the two centres
 * 3.6e-7 apart across the axis while each rail is a circle to 2.5e-12), and a centre moved that way moves the arc by ~(span²/8) of it. Last, the planes
 * apart by more than `tol` (closer, the strip is within `tol` of a plane).
 */
export function coaxialRails(a: Vec3[], b: Vec3[], tol: number): CoaxialRails {
  const A = fitArc(a);
  const B = fitArc(b);
  if (!A || !B) return { ok: false, reason: 'not-an-arc' };
  if (A.flat > tol || B.flat > tol) return { ok: false, reason: 'not-flat' };
  if (A.bow <= tol || B.bow <= tol) return { ok: false, reason: 'straight' };
  if (A.residual > tol || B.residual > tol) return { ok: false, reason: 'not-a-circle' };
  const nb = dot(A.normal, B.normal) < 0 ? mul(B.normal, -1) : B.normal;
  let axis = add(A.normal, nb);
  axis = mul(axis, 1 / len(axis));
  const d = sub(B.centre, A.centre);
  if (dot(d, axis) < 0) axis = mul(axis, -1);
  const through = add(A.centre, mul(d, 0.5));
  const height = (p: Vec3) => dot(sub(p, through), axis);
  const radius = (p: Vec3) => {
    const w = sub(p, through);
    return len(sub(w, mul(axis, dot(w, axis))));
  };
  const [ha, hb] = [band(a.map(height)), band(b.map(height))];
  if (ha.half > tol || hb.half > tol) return { ok: false, reason: 'planes-not-parallel' };
  const [ra, rb] = [band(a.map(radius)), band(b.map(radius))];
  if (ra.half > tol || rb.half > tol) return { ok: false, reason: 'not-coaxial' };
  if (hb.mid - ha.mid <= tol) return { ok: false, reason: 'one-plane' };
  return { ok: true, origin: add(through, mul(axis, ha.mid)), axis, ra: ra.mid, rb: rb.mid, height: hb.mid - ha.mid };
}

/**
 * The surfaces coaxial rails imply: the cylinder of their mean radius, and — when the radii differ — the cone through both. `at` is a point of the face
 * and `out` its outward normal there, for the side (`convex`: the outward normal points away from the axis).
 */
export function stripSurfaces(rails: Extract<CoaxialRails, { ok: true }>, at: Vec3, out: Vec3): { cylinder: SurfaceGeometry; cone: SurfaceGeometry | null } {
  const { origin, axis, ra, rb, height } = rails;
  const w = sub(at, origin);
  const radial = sub(w, mul(axis, dot(w, axis)));
  const convex = dot(out, radial) > 0;
  const cylinder: SurfaceGeometry = { type: 'cylinder', origin, axis, radius: (ra + rb) / 2, convex };
  const k = (rb - ra) / height; // the radius' change per mm along the axis
  if (k === 0) return { cylinder, cone: null };
  // the radius grows along the cone's axis from its apex, as OCCT's gp_Cone with a positive semi-angle
  const apex = sub(origin, mul(axis, ra / k));
  const coneAxis = k > 0 ? axis : mul(axis, -1);
  return { cylinder, cone: { type: 'cone', apex, axis: coneAxis, halfAngle: Math.atan(Math.abs(k)), convex } };
}
