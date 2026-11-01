/**
 * Nearest point on a curve (G18, ADR 0223). The ellipse used to read the cursor's direction as the eccentric angle, which is exact for a circle and wrong
 * by tens of millimetres on a flat one; a spline was measured on its drawn 16-step polyline instead of the curve. Both are checked here against ground
 * truth that does not share the implementation's method: for an ellipse the normal condition (the line from the cursor must be perpendicular to the
 * tangent) and a dense sweep; for a spline, a dense sweep of the very curve `sample` draws, which is what the wiggly bits are defined to be.
 */
import { describe, expect, it } from 'vitest';
import { closestOn, hitTest, sample } from '../src/interact';
import type { P2, SolvedGeometry } from '../src/types';

/** Deterministic pseudo-random numbers, so a fuzz failure can be reproduced from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const d = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const ellipse = (a: number, b: number, angle: number, c: P2 = [0, 0]): Extract<SolvedGeometry, { type: 'ellipse' }> => ({
  type: 'ellipse',
  c,
  major: [c[0] + a, c[1]],
  majorRadius: a,
  minorRadius: b,
  angle,
  center: 'c',
  majorId: 'm',
  construction: false,
});

const spline = (points: P2[], closed = false, bezier = false): Extract<SolvedGeometry, { type: 'spline' }> => ({
  type: 'spline',
  points,
  closed,
  ...(bezier ? { bezier: true } : {}),
  pointIds: points.map((_, i) => `p${i}`),
  construction: false,
});

/** The tangent of an ellipse at parameter t, in the ellipse's own frame. */
const tangent = (a: number, b: number, t: number): P2 => [-a * Math.sin(t), b * Math.cos(t)];

/**
 * The nearest point of an ellipse by a dense sweep then a ternary refinement (no shared code with `closestOn`). `steps` is the sweep: 200 000 for the
 * documented cases, 8 192 in the fuzz, where the refinement is what carries the accuracy — the sweep only has to land in the right basin.
 */
function ellipseTruth(a: number, b: number, x: number, y: number, steps = 8192): { q: P2; dist: number } {
  const at = (t: number): P2 => [a * Math.cos(t), b * Math.sin(t)];
  const f = (t: number) => (at(t)[0] - x) ** 2 + (at(t)[1] - y) ** 2;
  let best = 0;
  let bestValue = Infinity;
  for (let i = 0; i < steps; i++) {
    const t = (2 * Math.PI * i) / steps;
    const v = f(t);
    if (v < bestValue) {
      bestValue = v;
      best = t;
    }
  }
  let lo = best - (2 * Math.PI) / steps;
  let hi = best + (2 * Math.PI) / steps;
  for (let k = 0; k < 300; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (f(m1) < f(m2)) hi = m2;
    else lo = m1;
  }
  const q = at((lo + hi) / 2);
  return { q, dist: Math.hypot(q[0] - x, q[1] - y) };
}

/** An independent Catmull-Rom evaluation, for the truth and for pinning what `sample` draws. */
function catmull(p0: P2, p1: P2, p2: P2, p3: P2, t: number): P2 {
  const t2 = t * t;
  const t3 = t2 * t;
  const at = (i: 0 | 1) =>
    0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
  return [at(0), at(1)];
}

function bezierAt(points: readonly P2[], t: number): P2 {
  const work = points.map((p) => [...p] as P2);
  for (let n = work.length - 1; n > 0; n--)
    for (let i = 0; i < n; i++) work[i] = [work[i]![0] * (1 - t) + work[i + 1]![0] * t, work[i]![1] * (1 - t) + work[i + 1]![1] * t];
  return work[0]!;
}

/**
 * The nearest point of a spline: a 2 000-step sweep of each segment (or of the whole Bezier) and a ternary refinement between the best neighbours. The
 * curve here is the definition, so this is the true point, not an approximation of the drawn polyline.
 */
function splineTruth(g: Extract<SolvedGeometry, { type: 'spline' }>, p: P2): { q: P2; dist: number } {
  const n = g.points.length;
  const pick = (i: number): P2 => {
    if (g.closed) return g.points[((i % n) + n) % n]!;
    if (i < 0) return [2 * g.points[0]![0] - g.points[1]![0], 2 * g.points[0]![1] - g.points[1]![1]];
    if (i >= n) return [2 * g.points[n - 1]![0] - g.points[n - 2]![0], 2 * g.points[n - 1]![1] - g.points[n - 2]![1]];
    return g.points[i]!;
  };
  const at = (s: number, t: number): P2 => (g.bezier ? bezierAt(g.points, t) : catmull(pick(s - 1), pick(s), pick(s + 1), pick(s + 2), t));
  const segments = g.bezier ? 1 : g.closed ? n : n - 1;
  const f = (s: number, t: number) => (at(s, t)[0] - p[0]) ** 2 + (at(s, t)[1] - p[1]) ** 2;
  let bestS = 0;
  let bestT = 0;
  let bestValue = Infinity;
  for (let s = 0; s < segments; s++)
    for (let i = 0; i <= 2000; i++) {
      const v = f(s, i / 2000);
      if (v < bestValue) {
        bestValue = v;
        bestS = s;
        bestT = i / 2000;
      }
    }
  let lo = Math.max(0, bestT - 1 / 2000);
  let hi = Math.min(1, bestT + 1 / 2000);
  for (let k = 0; k < 300; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (f(bestS, m1) < f(bestS, m2)) hi = m2;
    else lo = m1;
  }
  const q = at(bestS, (lo + hi) / 2);
  return { q, dist: Math.hypot(q[0] - p[0], q[1] - p[1]) };
}

/** The direction as the eccentric angle, which is what `closestOn` did before ADR 0223 — kept so the fixed cases prove the error was real. */
const oldEllipsePoint = (a: number, b: number, p: P2): P2 => {
  const t = Math.atan2(p[1] * a, p[0] * b);
  return [a * Math.cos(t), b * Math.sin(t)];
};

describe('nearest point on an ellipse (G18)', () => {
  it('is the true nearest point on the measured cases, where the old formula was 27 to 72 mm off', () => {
    const cases: { a: number; b: number; p: P2 }[] = [
      { a: 100, b: 0.5, p: [30, 5] }, // 27 mm off before
      { a: 100, b: 0.5, p: [60, 3] }, // 50 mm
      { a: 100, b: 0.5, p: [95, 2] }, // 72 mm
      { a: 100, b: 5, p: [70, 9] }, // 52 mm
      { a: 100, b: 5, p: [40, 12] },
      { a: 50, b: 25, p: [30, 30] },
    ];
    for (const c of cases) {
      const truth = ellipseTruth(c.a, c.b, c.p[0], c.p[1], 200000);
      const q = closestOn(ellipse(c.a, c.b, 0), c.p)!;
      expect(d(q, truth.q)).toBeLessThan(1e-6);
      expect(Math.abs(d(q, c.p) - truth.dist)).toBeLessThan(1e-9);
      // the old answer, so this test cannot quietly stop testing anything
      expect(d(oldEllipsePoint(c.a, c.b, c.p), truth.q)).toBeGreaterThan(1);
    }
  });

  it('is exact on a circle and on the ends of a flat ellipse (where the old formula agreed by luck)', () => {
    const g = ellipse(10, 10, 0.7, [3, -2]);
    for (const p of [[20, 5], [-4, -9], [3, 8]] as P2[]) {
      const q = closestOn(g, p)!;
      expect(d(q, g.c)).toBeCloseTo(10, 9);
      const radial = [(p[0] - g.c[0]) / d(p, g.c), (p[1] - g.c[1]) / d(p, g.c)];
      // the distance to a circle is flat at its minimum, so the parameter is good to ~1e-9 rad: a hundredth of a nanometre out here
      expect(d(q, [g.c[0] + 10 * radial[0]!, g.c[1] + 10 * radial[1]!])).toBeLessThan(1e-7);
    }
    const flat = ellipse(100, 0.5, 0);
    const end = closestOn(flat, [130, 0])!;
    expect(end[0]).toBeCloseTo(100, 9);
    expect(end[1]).toBeCloseTo(0, 6); // the flat end: the parameter moves the point fastest there, so it is good to a few nanometres
  });

  it('satisfies the normal condition for 200 random ellipses, inside and outside, flat and round (fuzz)', () => {
    const r = rng(20261101);
    let worstAlong = 0;
    let worstDistanceError = 0;
    for (let k = 0; k < 200; k++) {
      const a = 1 + r() * 500;
      const b = Math.max(1e-3, a * (1e-3 + r() * 0.999));
      const angle = r() * Math.PI * 2;
      const c: P2 = [(r() - 0.5) * 200, (r() - 0.5) * 200];
      // the cursor, from inside the evolute out past the ellipse, in the ellipse's own frame
      const u = (r() - 0.5) * 3 * a;
      const v = (r() - 0.5) * 3 * a;
      const p: P2 = [c[0] + u * Math.cos(angle) - v * Math.sin(angle), c[1] + u * Math.sin(angle) + v * Math.cos(angle)];
      const q = closestOn(ellipse(a, b, angle, c), p)!;
      const lx = (q[0] - c[0]) * Math.cos(angle) + (q[1] - c[1]) * Math.sin(angle);
      const ly = -(q[0] - c[0]) * Math.sin(angle) + (q[1] - c[1]) * Math.cos(angle);
      // 1) the answer is on the ellipse; on its own this says nothing about being nearest
      expect(Math.abs((lx / a) ** 2 + (ly / b) ** 2 - 1)).toBeLessThan(1e-9);
      // 2) the cursor lies on the normal at q — the analytic condition for a nearest point, independent of how q was found
      const tan = tangent(a, b, Math.atan2(ly / b, lx / a));
      const radial: P2 = [lx - u, ly - v];
      const len = Math.hypot(radial[0], radial[1]) * Math.hypot(tan[0], tan[1]);
      if (len > 1e-9) worstAlong = Math.max(worstAlong, Math.abs(radial[0] * tan[0] + radial[1] * tan[1]) / len);
      // 3) nothing on a dense sweep is closer, and the distance matches the swept-and-refined truth
      worstDistanceError = Math.max(worstDistanceError, Math.abs(d(q, p) - ellipseTruth(a, b, u, v).dist));
      for (let i = 0; i < 200; i++) {
        const s = (2 * Math.PI * i) / 200;
        const candidate: P2 = [
          c[0] + a * Math.cos(s) * Math.cos(angle) - b * Math.sin(s) * Math.sin(angle),
          c[1] + a * Math.cos(s) * Math.sin(angle) + b * Math.sin(s) * Math.cos(angle),
        ];
        expect(d(p, q)).toBeLessThanOrEqual(d(p, candidate) + 1e-9);
      }
    }
    // the cosine between the cursor line and the tangent is 0 at a nearest point: 1.5e-7 in the worst case (a point inside the evolute, where the distance is
    // flat to several digits) — a tenth of a microradian, nothing on screen
    expect(worstAlong).toBeLessThan(1e-6);
    expect(worstDistanceError).toBeLessThan(1e-9);
  });
});

describe('nearest point on a spline (G18)', () => {
  it('follows the drawn curve rather than its 16-step polyline, on the measured cases (0.25 mm off before)', () => {
    const cases: { g: Extract<SolvedGeometry, { type: 'spline' }>; p: P2 }[] = [
      { g: spline([[0, 0], [50, 60], [80, -40], [140, 20]]), p: [40, 30] },
      { g: spline([[0, 0], [50, 60], [80, -40], [140, 20]]), p: [120, 5] },
      { g: spline([[0, 0], [8, 25], [30, 10], [20, -10], [45, -5], [60, 20]]), p: [25, 2] },
      { g: spline([[0, 0], [8, 25], [30, 10], [20, -10], [45, -5], [60, 20]]), p: [18, -6] },
    ];
    for (const c of cases) {
      const truth = splineTruth(c.g, c.p);
      const q = closestOn(c.g, c.p)!;
      expect(d(q, truth.q)).toBeLessThan(1e-6);
      expect(Math.abs(d(q, c.p) - truth.dist)).toBeLessThan(1e-9);
    }
  });

  it('holds for 100 random splines, open and closed, with loops and near-cusps (fuzz)', () => {
    const r = rng(4417);
    for (let k = 0; k < 100; k++) {
      const n = 2 + Math.floor(r() * 6);
      const points: P2[] = Array.from({ length: n }, () => [(r() - 0.5) * 160, (r() - 0.5) * 160]);
      const g = spline(points, r() < 0.3);
      const p: P2 = [(r() - 0.5) * 200, (r() - 0.5) * 200];
      const q = closestOn(g, p)!;
      const truth = splineTruth(g, p);
      // nothing on the curve is nearer, judged against a 2 000-step sweep of every segment refined by ternary search: the distance is what the pick compares
      expect(d(q, p)).toBeLessThanOrEqual(truth.dist + 1e-9);
      // and the point is the same one (near a cusp the position is ill-conditioned, so this is looser than the distance above — still a thousandth of a pixel)
      expect(d(q, truth.q)).toBeLessThan(1e-4);
    }
  });

  it('finds the nearest point of a Bezier spline (its poles are not the curve)', () => {
    const g = spline([[0, 0], [0, 60], [60, 60], [60, 0]], false, true);
    const p: P2 = [30, 20];
    const q = closestOn(g, p)!;
    expect(d(q, splineTruth(g, p).q)).toBeLessThan(1e-6);
    expect(d(q, p)).toBeCloseTo(24.641, 3); // measured; the curve's top at x = 30 is 25 mm away, and that is not the nearest point
    // the poles are 40 mm away at this height: what was found is on the curve, not on the control polygon
    for (const pole of g.points) expect(d(q, pole)).toBeGreaterThan(1);
  });

  it('keeps drawing the same polyline as before the rewrite (16 steps per segment, unchanged)', () => {
    const g = spline([[0, 0], [10, 20], [30, 5]]);
    const drawn = sample(g, 0.18);
    expect(drawn).toHaveLength(33);
    expect(drawn[0]).toEqual([0, 0]);
    expect(drawn[32]).toEqual([30, 5]);
    const mirror = (i: number): P2 =>
      i < 0
        ? [2 * g.points[0]![0] - g.points[1]![0], 2 * g.points[0]![1] - g.points[1]![1]]
        : i > 2
          ? [2 * g.points[2]![0] - g.points[1]![0], 2 * g.points[2]![1] - g.points[1]![1]]
          : g.points[i]!;
    for (let s = 0; s < 2; s++)
      for (let i = 0; i < 16; i++) expect(drawn[s * 16 + i]).toEqual(catmull(mirror(s - 1), mirror(s), mirror(s + 1), mirror(s + 2), i / 16));
    const closed = sample(spline([[0, 0], [10, 20], [30, 5]], true), 0.18);
    expect(closed).toHaveLength(49);
    expect(closed[48]).toEqual(closed[0]);
  });

  it('is what the pick uses: a flat ellipse beside a line no longer wins when the cursor is nearer the line', () => {
    // Measured before the fix: with the cursor 0.2–0.6 mm from the line and 60–100 mm out along a 200:1 ellipse, 474 of 483 picks took the ellipse.
    const flat = ellipse(100, 0.5, 0);
    const g = new Map<string, SolvedGeometry>([
      ['e1', flat],
      ['l1', { type: 'line', a: [-110, -0.5], b: [110, -0.5], p1: 'a', p2: 'b', construction: false }],
    ]);
    let wrong = 0;
    let probes = 0;
    for (let x = 60; x <= 100; x += 0.25) {
      for (const y of [-0.2, 0.2, 0.6]) {
        const p: P2 = [x, y];
        const toEllipse = ellipseTruth(100, 0.5, x, y).dist;
        const toLine = Math.abs(y + 0.5);
        if (Math.abs(toEllipse - toLine) < 1e-3) continue; // a genuine tie: either answer is right
        probes++;
        if (hitTest(g, p, 5.04)?.id !== (toEllipse < toLine ? 'e1' : 'l1')) wrong++;
      }
    }
    expect(probes).toBe(483);
    expect(wrong).toBe(0);
  });
});
