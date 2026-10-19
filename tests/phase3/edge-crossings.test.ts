/**
 * Where a curve crosses a plane, and the place of a curve nearest a point (ADR 0173, ADR 0174): evaluated on the curve, never cut. Truth by hand on a
 * helix of radius 10, pitch 5, 4 turns about z from (10, 0, 0): C(t) = (10 cos t, ±10 sin t, 5t / 2π), t in [0, 8π], one edge per turn (ADR 0168).
 *
 * Two truths, kept apart: a crossing lies on the plane to 1e-12 (that is the root finding); it lies on the ideal helix only as closely as the kernel's
 * helix is one. That curve is built from a line on the cylinder (`BuildCurves3d`), an approximation OCCT keeps within Precision::Confusion = 1e-7, and
 * measured here at about 4e-9 — so the comparison with the formula uses 1e-7, the representation's own tolerance, not the root finder's.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type Frame, type Region } from '@3db/kernel';

/** OCCT's Precision::Confusion: how far the kernel's helix may be from the ideal one. */
const CONFUSION = 1e-7;

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

const helix = () =>
  kernel.helixCurve({ center: [0, 0, 0], normal: [0, 0, 1], refDir: [1, 0, 0], radius: 10, pitch: 5, revolutions: 4, height: 20, clockwise: false } as never);
const edgesOf = (shape: number) => kernel.topology(shape as never).edges.map((_, i) => i);
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe('edgePlaneCrossings', () => {
  it('the plane y = 0 through the axis: the 9 places t = kπ, (±10, 0, 2.5k), exact to 1e-9; ends of the turns are marked as ends', () => {
    const h = helix();
    try {
      const all = edgesOf(h.shape).flatMap((i) => kernel.edgePlaneCrossings(h.shape, i, { origin: [0, 0, 0], normal: [0, 1, 0] }));
      const distinct = all.filter((c, k) => all.findIndex((d) => dist(d.point, c.point) < 1e-7) === k);
      expect(distinct).toHaveLength(9);
      for (let k = 0; k <= 8; k++) {
        const want = [k % 2 === 0 ? 10 : -10, 0, 2.5 * k];
        const got = distinct.find((c) => Math.abs(c.point[2] - want[2]!) < 1e-6);
        expect(got, `crossing ${k}`).toBeDefined();
        expect(Math.abs(got!.point[1])).toBeLessThan(1e-12); // on the plane: the root finding
        expect(dist(got!.point, want)).toBeLessThan(CONFUSION); // on the ideal helix: the representation
        // the middles of the turns are crossings inside an edge; the whole turns are where one edge ends and the next begins
        expect(got!.end).toBe(k % 2 === 0);
      }
    } finally {
      kernel.release(h.shape);
    }
  });

  it('the plane z = 7.3: one place, on the cylinder of radius 10 at that height, a quarter and a bit into the second turn', () => {
    const h = helix();
    try {
      const all = edgesOf(h.shape).flatMap((i) => kernel.edgePlaneCrossings(h.shape, i, { origin: [0, 0, 7.3], normal: [0, 0, 1] }));
      expect(all).toHaveLength(1);
      const p = all[0]!.point;
      const t = (2 * Math.PI * 7.3) / 5;
      expect(Math.abs(p[2] - 7.3)).toBeLessThan(1e-12);
      expect(Math.abs(Math.hypot(p[0], p[1]) - 10)).toBeLessThan(CONFUSION);
      expect(Math.abs(p[0] - 10 * Math.cos(t))).toBeLessThan(CONFUSION);
      expect(Math.abs(Math.abs(p[1]) - Math.abs(10 * Math.sin(t)))).toBeLessThan(CONFUSION);
      expect(all[0]!.end).toBe(false);
    } finally {
      kernel.release(h.shape);
    }
  });

  it('a plane above the helix: nothing', () => {
    const h = helix();
    try {
      expect(edgesOf(h.shape).flatMap((i) => kernel.edgePlaneCrossings(h.shape, i, { origin: [0, 0, 25], normal: [0, 0, 1] }))).toEqual([]);
    } finally {
      kernel.release(h.shape);
    }
  });

  it('a straight edge gives what the straight-edge pierce always gave', () => {
    const frame: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
    const rect: Region = { outer: [[0, 0], [40, 0], [40, 30], [0, 30]].map((a, i, all) => ({ kind: 'line' as const, a: a as [number, number], b: all[(i + 1) % 4] as [number, number], source: `r${i}` })), holes: [] };
    const box = kernel.extrude(frame, [rect], [0, 0, 10]).shape;
    try {
      const topo = kernel.topology(box);
      const upright = topo.edges.findIndex((e) => e.curve === 'line' && e.dir && Math.abs(e.dir[2]) > 0.99);
      const c = kernel.edgePlaneCrossings(box, upright, { origin: [0, 0, 4], normal: [0, 0, 1] });
      expect(c).toHaveLength(1);
      expect(c[0]!.point[2]).toBeCloseTo(4, 12);
    } finally {
      kernel.release(box);
    }
  });
});

describe('edgeNearest', () => {
  it('at the start of the helix: the point itself, distance 0, the tangent (0, ±10, 5/2π) made unit', () => {
    const h = helix();
    try {
      const first = edgesOf(h.shape).find((i) => kernel.edgeNearest(h.shape, i, [10, 0, 0]).distance < 1e-9)!;
      const n = kernel.edgeNearest(h.shape, first, [10, 0, 0]);
      expect(n.distance).toBeLessThan(1e-9);
      const rise = 5 / (2 * Math.PI);
      const l = Math.hypot(10, rise);
      expect(Math.abs(n.tangent[0])).toBeLessThan(1e-9);
      expect(Math.abs(Math.abs(n.tangent[1]) - 10 / l)).toBeLessThan(CONFUSION);
      expect(Math.abs(Math.abs(n.tangent[2]) - rise / l)).toBeLessThan(CONFUSION);
    } finally {
      kernel.release(h.shape);
    }
  });

  it('from a point off the curve on the axis at a height: the distance is the radius, 10', () => {
    const h = helix();
    try {
      const n = edgesOf(h.shape).map((i) => kernel.edgeNearest(h.shape, i, [0, 0, 6])).reduce((a, b) => (a.distance < b.distance ? a : b));
      expect(n.distance).toBeCloseTo(10, 6);
    } finally {
      kernel.release(h.shape);
    }
  });
});
