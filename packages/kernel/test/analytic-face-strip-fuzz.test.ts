/**
 * ADR 0258 fuzz (a file of its own: AGENTS.md §3.4). Seeded B-spline strips between two circle arcs — arc span 1°–10°, half-angle 0°–60° either way,
 * radius 1–100, anywhere in space, degree 2 or 3 along the arcs, up to 2 inner knots, either direction ruled — made from their definition
 * (`analytic-face-strip.kit`), each read by `Kernel.analyticFace` at a tolerance below what the strip itself could hide in (its arcs bow, and a cone's
 * radii differ, by at least 10·tol).
 *
 * - Exact strips: read as the cone or cylinder they are, with its sizes, deviation at rounding level.
 * - Fanned strips (the second arc spans more about the same middle, as in both real files): off their cone by the sag of the end rulings, which the
 *   test computes from the definition (2001 points along each end ruling, against the cone's equation in the plane of its axis) and keeps at most
 *   0.9·tol. Read as that cone or cylinder, with the deviation the sag. OCCT on its own misses many of these (the reason for the fallback).
 * - Near misses, each moved by at least 100·tol against the strip's own axis by a measure of the test's own: the second rail off the axis, out of
 *   parallel, turned about the axis (a hyperboloid's strip), or both rails elliptic. Refused: null, or else only what OCCT on its own proposes, of its
 *   type, within tol at 41 × 41 points of the test's own (a narrow strip moved off its axis can be within tol of a cone on a tilted one: measured 3 of
 *   15 offsets and 3 of 15 tilts, read by OCCT; twists and ellipses 0).
 * - The guard: a cone strip is never read as a cylinder, at any tolerance below its own bow and radius change.
 * Every branch is counted and each count must be non-zero.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type SurfaceGeometry, type Vec3 } from '../src';
import { stripFace, type StripSpec } from './analytic-face-strip.kit';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const D = Math.PI / 180;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3) => Math.hypot(...a);
const unit = (a: Vec3): Vec3 => mul(a, 1 / len(a));
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The distance of local point (ρ, z) — ρ from the axis, z along it from rail a's plane — from the strip's design surface. */
function offDesign(spec: StripSpec, rho: number, z: number): number {
  if (spec.half === 0) return Math.abs(rho - spec.r0);
  // the cone's ruling in the half-plane: through (r0, 0) at the half-angle
  const t = Math.tan(spec.half);
  return Math.abs(rho - (spec.r0 + z * t)) * Math.cos(spec.half);
}

/** The largest distance of the end rulings (straight lines between the rails' end points, local terms) from the design surface. */
function endSag(spec: StripSpec): number {
  const s = spec.span;
  const sb = s * (spec.widen ?? 1);
  const a0 = spec.start ?? 0;
  const r1 = spec.r0 + spec.height * Math.tan(spec.half);
  let sag = 0;
  for (const [ta, tb] of [
    [a0, a0 + (s - sb) / 2],
    [a0 + s, a0 + (s - sb) / 2 + sb],
  ] as const) {
    const A: Vec3 = [spec.r0 * Math.cos(ta), spec.r0 * Math.sin(ta), 0];
    const B: Vec3 = [r1 * Math.cos(tb), r1 * Math.sin(tb), spec.height];
    for (let i = 0; i <= 2000; i++) {
      const t = i / 2000;
      const p: Vec3 = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
      sag = Math.max(sag, offDesign(spec, Math.hypot(p[0], p[1]), p[2]));
    }
  }
  return sag;
}

/** A random strip: everything but the near misses and the fan. */
function baseSpec(r: () => number, cylinder: boolean): { spec: StripSpec; tol: number } {
  const r0 = Math.exp(Math.log(1) + r() * Math.log(100));
  const span = (1 + 9 * r()) * D;
  const bow = Math.min(r0 * (1 - Math.cos(span / 2)));
  const tols = [1e-6, 1e-5, 1e-4].filter((t) => bow >= 10 * t);
  const tol = tols[Math.floor(r() * tols.length)]!;
  let half = 0;
  let height = 0.5 + 19.5 * r();
  if (!cylinder) {
    // half of them shallow (0.05°–5°, as E13): OCCT misses fanned cones there (c13l)
    half = (r() < 0.5 ? 0.05 + 4.95 * r() : 5 + 55 * r()) * D * (r() < 0.3 ? -1 : 1);
    // a radius change of at least 10·tol; a shrinking cone keeps at least half its radius
    height = Math.max(height, (10 * tol) / Math.tan(Math.abs(half)));
    if (half < 0) height = Math.min(height, (0.5 * r0) / Math.tan(-half));
    if (height * Math.tan(Math.abs(half)) < 10 * tol) half = -half; // a shrinking one with no room: grow instead
  }
  const axis = unit([r() - 0.5, r() - 0.5, r() - 0.5]);
  const ref: Vec3 = cross(axis, unit([r() - 0.5, r() - 0.5, r() - 0.5]));
  const spec: StripSpec = {
    r0,
    half,
    height,
    span,
    start: r() * 2 * Math.PI,
    degree: r() < 0.5 ? 2 : 3,
    knots: Math.floor(r() * 3),
    swap: r() < 0.5,
    frame: { origin: [100 * (r() - 0.5), 100 * (r() - 0.5), 100 * (r() - 0.5)], axis, ref },
  };
  return { spec, tol };
}

/** The frame of `spec` as the kit builds it: a point of the axis on rail a's plane, the axis. */
function frameOf(spec: StripSpec): { o: Vec3; z: Vec3 } {
  return { o: spec.frame!.origin, z: unit(spec.frame!.axis) };
}

/** `g`'s distance from `p`, by its definition (cone: in the plane of its axis). */
function offSurface(g: SurfaceGeometry, p: Vec3): number {
  if (g.type === 'cylinder') {
    const w = sub(p, g.origin);
    return Math.abs(len(sub(w, mul(g.axis, dot(w, g.axis)))) - g.radius);
  }
  if (g.type === 'cone') {
    const w = sub(p, g.apex);
    const z = dot(w, g.axis);
    return Math.abs(len(sub(w, mul(g.axis, z))) * Math.cos(g.halfAngle) - z * Math.sin(g.halfAngle));
  }
  if (g.type === 'plane') return Math.abs(dot(sub(p, g.origin), g.normal));
  if (g.type === 'sphere') return Math.abs(len(sub(p, g.center)) - g.radius);
  const w = sub(p, g.center);
  const z = dot(w, g.axis);
  return Math.abs(Math.hypot(len(sub(w, mul(g.axis, z))) - g.major, z) - g.minor);
}

/** The largest distance of the face (41 × 41 points over its parameters) from `g`. */
function denseOff(shape: unknown, g: SurfaceGeometry): number {
  const k = kernel as any;
  const oc = k.oc;
  const ex = new oc.TopExp_Explorer(k.get(shape), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  const ad = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(ex.Current()), true);
  let m = 0;
  for (let i = 0; i <= 40; i++) {
    for (let j = 0; j <= 40; j++) {
      const p = ad.Value(ad.FirstUParameter() + ((ad.LastUParameter() - ad.FirstUParameter()) * i) / 40, ad.FirstVParameter() + ((ad.LastVParameter() - ad.FirstVParameter()) * j) / 40);
      m = Math.max(m, offSurface(g, [p.X(), p.Y(), p.Z()]));
      p.delete();
    }
  }
  ad.delete();
  ex.delete();
  return m;
}

const READS = 160;
const MISSES_PER_KIND = 15;

describe('coaxial-arc strips, seeded', () => {
  it(`${READS} strips read as the cone or cylinder they are; OCCT alone misses the fanned ones`, () => {
    const count = { exactCone: 0, exactCylinder: 0, fannedCone: 0, fannedCylinder: 0, occtMissedCone: 0, occtMissedCylinder: 0, occtOtherType: 0, guardChecks: 0 };
    for (let seed = 1; seed <= READS; seed++) {
      const r = rng(seed);
      // a quarter cylinders, exact and fanned alike
      const cylinder = seed % 8 < 2;
      const fanned = seed % 2 === 1;
      const { spec, tol } = baseSpec(r, cylinder);
      if (fanned) {
        // OCCT on its own misses a strip by how far its rulings fan (measured, c13l: widenings of 1.05–1.2 missed at sags of 0.002–0.9·tol), not by
        // the sag: the widening is drawn from 1.02–1.3, its excess halved until the sag is at most 0.9·tol
        let widen = 1.02 + 0.28 * r();
        while (endSag({ ...spec, widen }) > 0.9 * tol) widen = 1 + (widen - 1) / 2;
        spec.widen = widen;
      }
      const sag = endSag(spec);
      const label = `seed ${seed} ${JSON.stringify({ ...spec, frame: undefined })} tol ${tol} sag ${sag.toExponential(2)}`;
      if (fanned) expect(sag, label).toBeGreaterThan(0);
      const made = stripFace(kernel, spec);
      try {
        const occt = made.occt(tol);
        const read = kernel.analyticFace(made.shape, 0, tol);
        const want = cylinder ? 'cylinder' : 'cone';
        if (occt === null) count[cylinder ? 'occtMissedCylinder' : 'occtMissedCone']++;
        else if (occt !== want) count.occtOtherType++;
        expect(read?.geometry.type, label).toBe(want);
        const g = read!.geometry;
        expect(read!.deviation, label).toBeLessThanOrEqual(tol);
        if (fanned) {
          // the sag, as the 13 rows across the face catch its peak
          expect(read!.deviation, label).toBeGreaterThan(0.9 * sag);
          expect(read!.deviation, label).toBeLessThan(sag * (1 + 1e-6) + 1e-9);
        } else expect(read!.deviation, label).toBeLessThan(1e-9 * (1 + spec.r0));
        // the sizes, from the definition
        const { o, z } = frameOf(spec);
        const r1 = spec.r0 + spec.height * Math.tan(spec.half);
        expect(g.type !== 'plane' && g.convex, label).toBe(!spec.swap);
        if (g.type === 'cylinder') {
          expect(1 - Math.abs(dot(g.axis, z)), label).toBeLessThan(1e-9);
          expect(Math.abs(g.radius - spec.r0), label).toBeLessThan(1e-8 * (1 + spec.r0));
          const w = sub(o, g.origin);
          expect(len(sub(w, mul(g.axis, dot(w, g.axis)))), label).toBeLessThan(1e-7 * (1 + spec.r0));
          count[fanned ? 'fannedCylinder' : 'exactCylinder']++;
        } else if (g.type === 'cone') {
          expect(Math.abs(g.halfAngle - Math.abs(spec.half)), label).toBeLessThan(1e-9);
          // the axis points the way the radius grows
          expect(dot(g.axis, z) * Math.sign(spec.half), label).toBeGreaterThan(1 - 1e-9);
          // the cone's radius at each rail's plane is that rail's
          for (const [h, want_r] of [
            [0, spec.r0],
            [spec.height, r1],
          ] as const) {
            const at = dot(sub([o[0] + z[0] * h, o[1] + z[1] * h, o[2] + z[2] * h], g.apex), g.axis);
            expect(Math.abs(at * Math.tan(g.halfAngle) - want_r), label).toBeLessThan(1e-7 * (1 + spec.r0));
          }
          const w = sub(g.apex, o);
          expect(len(sub(w, mul(z, dot(w, z)))), label).toBeLessThan(1e-9 * (1 + len(w)));
          count[fanned ? 'fannedCone' : 'exactCone']++;
          // the guard: never a cylinder at any tolerance below the strip's own bow and radius change
          const bow = Math.min(spec.r0, r1) * (1 - Math.cos(spec.span / 2));
          for (const t of [1e-6, 1e-5, 1e-4, 1e-3]) {
            if (t < sag || t > bow / 10 || t > Math.abs(r1 - spec.r0) / 10) continue;
            expect(kernel.analyticFace(made.shape, 0, t)?.geometry.type, `${label} at ${t}`).toBe('cone');
            count.guardChecks++;
          }
        }
      } finally {
        made.release();
      }
    }
    console.log(`strip fuzz reads: ${JSON.stringify(count)}`);
    for (const [k, v] of Object.entries(count)) if (k !== 'occtOtherType') expect(v, k).toBeGreaterThan(0);
    expect(count.exactCone + count.exactCylinder + count.fannedCone + count.fannedCylinder).toBe(READS);
  }, 600_000);

  it(`near misses, ${MISSES_PER_KIND} of each kind, each moved ≥ 100·tol: refused`, () => {
    const count: Record<string, { refused: number; occt: number }> = {};
    for (const kind of ['offset', 'tilt', 'twist', 'ellipse'] as const) {
      count[kind] = { refused: 0, occt: 0 };
      for (let i = 0; i < MISSES_PER_KIND; i++) {
        const seed = 10_000 + 100 * ['offset', 'tilt', 'twist', 'ellipse'].indexOf(kind) + i;
        const r = rng(seed);
        const { spec } = baseSpec(r, i % 3 === 0);
        const tol = 1e-6;
        const want = 100 * tol;
        const phi = spec.span;
        const r1 = spec.r0 + spec.height * Math.tan(spec.half);
        const rmin = Math.min(spec.r0, r1);
        if (kind === 'offset') {
          // mostly along the arcs: a shift e shows as ~e·φ/2 against the axis, and ~e·r·φ/(2h) against an axis tilted to pass both centres
          const e = (2 * want) / Math.min(phi / 2, (rmin * phi) / (2 * spec.height));
          const dir = (spec.start ?? 0) + spec.span / 2 + Math.PI / 2 + (r() - 0.5) * (Math.PI / 2);
          spec.offset = [e * Math.cos(dir), e * Math.sin(dir)];
        } else if (kind === 'tilt') {
          // a tilt β shows as ~β·r·φ/2 of height along the arc
          spec.tilt = ((2 * want) / ((rmin * phi) / 2)) * (r() < 0.5 ? -1 : 1);
        } else if (kind === 'twist') {
          // a turn τ about the axis sags the rulings by ~r·τ²/8
          spec.twist = Math.sqrt((8 * 2 * want) / rmin) * (r() < 0.5 ? -1 : 1);
        } else {
          // An elliptic arc shows its ellipse by how its curvature changes along it, ~ length³: a 1° arc of radius 1 is within 6e-5 of a circle at any
          // stretch up to 5×, so it is no near miss at 1e-6. These arcs are 5°–10° of radius 10–100.
          spec.span = (5 + 5 * r()) * D;
          spec.r0 = 10 + 90 * r();
          // stretched until a circle through three of the rail's points misses the others by ≥ 2·want
          spec.ellipse = 1;
          for (let f = 1e-3; f < 4; f *= 1.5) {
            spec.ellipse = 1 + f;
            if (threePointMiss(spec) >= 2 * want) break;
          }
          expect(threePointMiss(spec)).toBeGreaterThanOrEqual(2 * want);
        }
        const made = stripFace(kernel, spec);
        try {
          const read = kernel.analyticFace(made.shape, 0, tol);
          const label = `${kind} seed ${seed}: ${JSON.stringify({ ...spec, frame: undefined })}`;
          if (read === null) count[kind]!.refused++;
          else {
            // not the strip's reading: OCCT's own, of its type, and within tol by the test's own dense measure
            expect(made.occt(tol), label).toBe(read.geometry.type);
            expect(denseOff(made.shape, read.geometry), label).toBeLessThanOrEqual(tol * (1 + 1e-6));
            count[kind]!.occt++;
          }
        } finally {
          made.release();
        }
      }
    }
    console.log(`strip fuzz near misses: ${JSON.stringify(count)}`);
    for (const [k, v] of Object.entries(count)) expect(v.refused, k).toBeGreaterThan(0);
  }, 600_000);
});

/** How far the elliptic rail b of `spec` (local terms, 201 points of its exact conic) is from the circle through its first, middle and last points. */
function threePointMiss(spec: StripSpec): number {
  const s = spec.span;
  const a0 = spec.start ?? 0;
  const r1 = spec.r0 + spec.height * Math.tan(spec.half);
  const m: Vec3 = [Math.cos(a0 + s / 2 + Math.PI / 4), Math.sin(a0 + s / 2 + Math.PI / 4), 0];
  const pts: Vec3[] = [];
  for (let i = 0; i <= 200; i++) {
    const a = a0 + (s * i) / 200;
    const p: Vec3 = [r1 * Math.cos(a), r1 * Math.sin(a), 0];
    const k = dot(p, m) * (spec.ellipse! - 1);
    pts.push([p[0] + m[0] * k, p[1] + m[1] * k, 0]);
  }
  const [A, B, C] = [pts[0]!, pts[100]!, pts[200]!];
  const ab = sub(B, A);
  const ac = sub(C, A);
  const n = cross(ab, ac);
  const c: Vec3 = [
    A[0] + (cross(n, ab)[0] * dot(ac, ac) + cross(ac, n)[0] * dot(ab, ab)) / (2 * dot(n, n)),
    A[1] + (cross(n, ab)[1] * dot(ac, ac) + cross(ac, n)[1] * dot(ab, ab)) / (2 * dot(n, n)),
    0,
  ];
  const rr = len(sub(A, c));
  return Math.max(...pts.map((p) => Math.abs(len(sub(p, c)) - rr)));
}
