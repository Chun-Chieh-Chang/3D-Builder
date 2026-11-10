/**
 * A sketch spline drawn by its poles as a clamped (rational) B-spline (C1): the exact outline recognition needs for walls that are B-spline curves carried
 * straight. Each check is against geometry known in closed form or against the curve the test itself made, never against the code under test.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type Frame, type Region } from '@3db/kernel';
import { PlaneGcsSolver, findProfiles } from '@3db/sketch';
import { nurbsPoint } from '@3db/sketch/interact';
import { reverseNurbs } from '../../packages/sketch/src/profiles';
import { applyCommand, createEmptyPart, nurbsValid, resolveSketch, sketchError, type SketchEntity, type SketchFeature } from '@3db/model';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

type P = [number, number];
const XY: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const pt = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const W = Math.SQRT1_2;
/** A quarter circle of radius r, exactly: the rational quadratic with its middle weight cos 45°. */
const quarter = (r: number) => ({ poles: [[r, 0], [r, r], [0, r]] as P[], degree: 2, knots: [0, 1], mults: [3, 3], weights: [1, W, 1] });

describe('the B-spline itself', () => {
  it('draws a quarter circle exactly with the rational quadratic', () => {
    const q = quarter(7);
    for (let i = 0; i <= 50; i++) {
      const [x, y] = nurbsPoint(q.poles, q, i / 50);
      expect(Math.abs(Math.hypot(x, y) - 7)).toBeLessThan(1e-12);
    }
    expect(nurbsPoint(q.poles, q, 0)).toEqual([7, 0]);
    expect(nurbsPoint(q.poles, q, 1)[0]).toBeCloseTo(0, 14);
  });

  it('is the same curve run the other way when reversed, with inner knots and weights', () => {
    const n = { poles: [[0, 0], [1, 3], [4, 4], [6, 1], [8, 2], [9, 0]] as P[], degree: 3, knots: [0, 0.3, 1.7, 2], mults: [4, 1, 1, 4], weights: [1, 2, 0.5, 1.5, 1, 1] };
    const r = reverseNurbs(n);
    for (let i = 0; i <= 40; i++) {
      const a = nurbsPoint(n.poles, n, i / 40);
      const b = nurbsPoint(r.poles, r, 1 - i / 40);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-12);
    }
  });

  it('refuses a definition that is not a clamped B-spline of its poles', () => {
    const ok = { degree: 3, knots: [0, 1, 2], mults: [4, 1, 4] };
    expect(nurbsValid(ok, 5)).toBe(true);
    expect(nurbsValid({ ...ok, mults: [4, 2, 4] }, 5)).toBe(false); // one pole short of the multiplicities
    expect(nurbsValid({ ...ok, mults: [3, 2, 4] }, 5)).toBe(false); // not clamped at the start
    expect(nurbsValid({ ...ok, knots: [0, 2, 1] }, 5)).toBe(false);
    expect(nurbsValid({ ...ok, knots: [0, 1, 1] }, 5)).toBe(false);
    expect(nurbsValid({ ...ok, degree: 2.5 }, 5)).toBe(false);
    expect(nurbsValid({ ...ok, degree: 0 }, 5)).toBe(false);
    expect(nurbsValid({ ...ok, weights: [1, 1, 0, 1, 1] }, 5)).toBe(false);
    expect(nurbsValid({ ...ok, weights: [1, 1, 1, 1] }, 5)).toBe(false);
    expect(nurbsValid({ ...ok, weights: [1, 1, Number.NaN, 1, 1] }, 5)).toBe(false);
    expect(nurbsValid(ok, 5, true)).toBe(false);
    expect(nurbsValid(ok, 5, false, true)).toBe(false);
    expect(nurbsValid({ ...ok, knots: [0, Infinity, 2] }, 5)).toBe(false);
  });
});

/** A quarter disc: two lines and the exact quarter circle, every point fixed. */
function quarterDisc(r: number, weights = true): SketchFeature {
  const q = quarter(r);
  return {
    id: 'sk', type: 'sketch', name: 'q', suppressed: false, plane: { kind: 'datum', name: 'plane:front' },
    entities: [pt('o', 0, 0), pt('a', r, 0), pt('m', r, r), pt('b', 0, r),
      { id: 'l1', type: 'line', p1: 'o', p2: 'a' },
      { id: 's', type: 'spline', points: ['a', 'm', 'b'], nurbs: { degree: 2, knots: q.knots, mults: q.mults, ...(weights ? { weights: q.weights } : {}) } },
      { id: 'l2', type: 'line', p1: 'b', p2: 'o' }],
    constraints: ['o', 'a', 'm', 'b'].map((p) => ({ id: `f${p}`, type: 'fix' as const, point: p })),
  };
}

describe('in a sketch', () => {
  it('is a valid entity, solved fully defined once its poles are fixed (the weights are no freedom of the sketch)', () => {
    const f = quarterDisc(5);
    const doc = applyCommand(createEmptyPart(), { type: 'insertFeature', index: 0, feature: f });
    const s = resolveSketch(doc.features[0] as SketchFeature, doc);
    expect(sketchError(s)).toBeNull();
    const solved = solver.solve(s);
    expect(solved.status).toBe('fully');
    expect(solved.dof).toBe(0);
  });

  it('extrudes to the exact quarter cylinder: volume πr²h/4 and area of its faces', () => {
    for (const r of [0.5, 5, 123.25]) {
      const f = quarterDisc(r);
      const doc = applyCommand(createEmptyPart(), { type: 'insertFeature', index: 0, feature: f });
      const s = resolveSketch(doc.features[0] as SketchFeature, doc);
      const profile = findProfiles(s, solver.solve(s));
      expect(profile.regions).toHaveLength(1);
      const h = 3;
      const solid = kernel.extrude(XY, profile.regions, [0, 0, h]);
      try {
        expect(kernel.isValid(solid.shape)).toBe(true);
        const m = kernel.massProps(solid.shape);
        expect(Math.abs(m.volume - (Math.PI * r * r * h) / 4) / ((Math.PI * r * r * h) / 4)).toBeLessThan(1e-9);
        const area = 2 * (Math.PI * r * r) / 4 + 2 * r * h + (Math.PI * r / 2) * h;
        expect(Math.abs(m.area - area) / area).toBeLessThan(1e-9);
      } finally {
        kernel.release(solid.shape);
      }
    }
  });

  it('without the weights is the plain quadratic, which is not the circle (the weights reach the solid)', () => {
    const f = quarterDisc(5, false);
    const doc = applyCommand(createEmptyPart(), { type: 'insertFeature', index: 0, feature: f });
    const s = resolveSketch(doc.features[0] as SketchFeature, doc);
    const solid = kernel.extrude(XY, findProfiles(s, solver.solve(s)).regions, [0, 0, 1]);
    try {
      // the plain quadratic from (5,0) to (0,5) about the corner pole (5,5) bulges out 2/3 of the triangle it cuts off: 12.5 + (2/3)·12.5 = 125/6,
      // more than the quarter circle's 25π/4 ≈ 19.63
      expect(kernel.massProps(solid.shape).volume).toBeCloseTo(125 / 6, 9);
    } finally {
      kernel.release(solid.shape);
    }
  });
});

describe('read back from a solid', () => {
  /** A solid whose one curved wall is the given B-spline carried straight up, closed below by straight lines. */
  const wall = (n: { poles: P[]; degree: number; knots: number[]; mults: number[]; weights?: number[] }): Region => {
    const a = n.poles[0]!;
    const b = n.poles[n.poles.length - 1]!;
    const floor = Math.min(...n.poles.map((p) => p[1])) - 5;
    return {
      outer: [
        { kind: 'line', a: [a[0], floor], b: [b[0], floor], source: 'bottom' },
        { kind: 'line', a: [b[0], floor], b, source: 'right' },
        { kind: 'spline', points: [], closed: false, source: 'curve', nurbs: { ...n, poles: [...n.poles].reverse(), knots: n.knots.map((k) => n.knots[0]! + n.knots[n.knots.length - 1]! - k).reverse(), mults: [...n.mults].reverse(), ...(n.weights ? { weights: [...n.weights].reverse() } : {}) } },
        { kind: 'line', a, b: [a[0], floor], source: 'left' },
      ],
      holes: [],
    };
  };

  it('a section square to the wall gives back the very B-spline the wall was made from', () => {
    const n = { poles: [[0, 0], [2, 4], [5, 5], [8, 1], [11, 3], [14, 0]] as P[], degree: 3, knots: [0, 0.4, 1.1, 2], mults: [4, 1, 1, 4], weights: [1, 1.7, 0.6, 1.2, 1, 1] };
    const region = wall(n);
    region.outer[2]!.kind === 'spline' && (region.outer[2]!.points = Array.from({ length: 49 }, (_, i) => nurbsPoint(n.poles, n, 1 - i / 48)));
    const solid = kernel.extrude(XY, [region], [0, 0, 10]);
    try {
      const at: Frame = { ...XY, origin: [0, 0, 6.5] };
      const edges = kernel.sectionCurves(solid.shape, at, { u0: -50, u1: 50, v0: -50, v1: 50 });
      const exact = edges.filter((e) => e.kind === 'nurbs');
      expect(exact).toHaveLength(1);
      const e = exact[0]!;
      if (e.kind !== 'nurbs') throw new Error('unreachable');
      // the same curve, whichever way it runs: compare points along it
      for (let i = 0; i <= 60; i++) {
        const p = nurbsPoint(e.poles, e, i / 60);
        const q1 = nurbsPoint(n.poles, n, i / 60);
        const q2 = nurbsPoint(n.poles, n, 1 - i / 60);
        expect(Math.min(Math.hypot(p[0] - q1[0], p[1] - q1[1]), Math.hypot(p[0] - q2[0], p[1] - q2[1]))).toBeLessThan(1e-9);
      }
      expect(e.degree).toBe(3);
      expect(e.poles).toHaveLength(6);
      // what plain sectionEdges gives is unchanged (no exact kind there)
      expect(kernel.sectionEdges(solid.shape, at, { u0: -50, u1: 50, v0: -50, v1: 50 }).every((x) => (x as { kind: string }).kind !== 'nurbs')).toBe(true);
    } finally {
      kernel.release(solid.shape);
    }
  });
});
