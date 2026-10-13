/**
 * The midpoint relation on an arc (schema 56; SolidWorks and FreeCAD snap to the middle of an arc): the point stays at the middle of the sweep when the
 * arc changes. To the solver it is on the arc's circle and on the perpendicular bisector of its ends, which meets the circle twice; the fuzz below
 * measures that the point keeps to the middle of the arc, not of the rest of the circle, through large changes of the arc.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, resolveSketch, type Command, type PartDoc, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver, type SolvedSketch } from '../src/index';
import { applicableRelations, arcMidpoint } from '../src/interact';

let solver: PlaneGcsSolver;
beforeAll(async () => {
  solver = await PlaneGcsSolver.create();
});

const EMPTY: Command = {
  type: 'insertFeature',
  index: 0,
  feature: { id: 's1', type: 'sketch', name: '草圖1', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] },
};
const start = (entities: SketchEntity[], constraints: SketchConstraint[] = []): PartDoc => applyCommand(applyCommand(createEmptyPart(), EMPTY), { type: 'addSketchItems', featureId: 's1', entities, constraints });
const sketchOf = (doc: PartDoc) => doc.features.find((f) => f.id === 's1') as SketchFeature;
const solve = (doc: PartDoc): SolvedSketch => solver.solve(resolveSketch(sketchOf(doc), doc), { analyze: true });
const pointAt = (s: SolvedSketch, id: string) => {
  const g = s.geometry.get(id);
  if (g?.type !== 'point') throw new Error(`no point ${id}`);
  return g.p;
};
const polar = (c: [number, number], r: number, a: number): [number, number] => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];

/** An arc about `c` of radius `r` from angle `a0` counterclockwise by `sweep`, its ends fixed and its radius given, and a point `m` at `mAt` held to its middle. */
function arcWithMiddle(c: [number, number], r: number, a0: number, sweep: number, mAt: [number, number], withMiddle = true): PartDoc {
  const [s, e] = [polar(c, r, a0), polar(c, r, a0 + sweep)];
  return start(
    [
      { id: 'c', type: 'point', x: c[0], y: c[1] },
      { id: 's', type: 'point', x: s[0], y: s[1] },
      { id: 'e', type: 'point', x: e[0], y: e[1] },
      { id: 'A', type: 'arc', center: 'c', start: 's', end: 'e' },
      { id: 'm', type: 'point', x: mAt[0], y: mAt[1] },
    ],
    [
      { id: 'fs', type: 'fix', point: 's' },
      { id: 'fe', type: 'fix', point: 'e' },
      { id: 'R', type: 'radius', circle: 'A', value: String(r) }, // the ends and the radius: the center follows (the side it is on now)
      ...(withMiddle ? [{ id: 'k', type: 'midpoint' as const, point: 'm', line: 'A' }] : []),
    ],
  );
}

describe('the middle of an arc (midpoint relation on an arc)', () => {
  it('puts the point at the middle of the sweep, for a short arc and for one of more than half a turn, and the sketch is fully defined', () => {
    // the arc itself is defined and nothing is redundant: only the point's two freedoms are left without the relation
    const bare = solve(arcWithMiddle([0, 0], 10, 0, (2 * Math.PI) / 3, [3, 4], false)); // not half a turn: there the chord is the diameter and the radius says nothing more
    expect(bare.status).toBe('under');
    expect(bare.dof).toBe(2);
    expect(bare.redundant).toEqual([]);
    for (const [a0, sweep, want] of [
      [Math.PI / 6, (2 * Math.PI) / 3, [0, 10]], // 30° to 150°: the top
      [0, (5 * Math.PI) / 3, polar([0, 0], 10, (5 * Math.PI) / 6)], // 0° to 300°: at 150°
    ] as const) {
      const s = solve(arcWithMiddle([0, 0], 10, a0, sweep, [want[0] + 0.7, want[1] - 0.4]));
      expect(s.status).toBe('fully');
      expect(s.redundant).toEqual([]);
      const m = pointAt(s, 'm');
      expect(m[0]).toBeCloseTo(want[0], 6);
      expect(m[1]).toBeCloseTo(want[1], 6);
    }
  });

  it('is refused on the arc\'s own end or center, and on a circle (a circle has no middle)', () => {
    const base = arcWithMiddle([0, 0], 10, 0, Math.PI, [0, 10]);
    for (const own of ['s', 'e', 'c']) {
      expect(() => applyCommand(base, { type: 'addSketchItems', featureId: 's1', entities: [], constraints: [{ id: `x${own}`, type: 'midpoint', point: own, line: 'A' }] }), own).toThrow(/中點|middle|midpoint/i);
    }
    const circle = start([{ id: 'c', type: 'point', x: 0, y: 0 }, { id: 'C', type: 'circle', center: 'c', radius: 5 }, { id: 'm', type: 'point', x: 5, y: 0 }]);
    expect(() => applyCommand(circle, { type: 'addSketchItems', featureId: 's1', entities: [], constraints: [{ id: 'k', type: 'midpoint', point: 'm', line: 'C' }] })).toThrow();
  });

  it('is offered in 加入限制條件 for a point and an arc, but not for one of the arc\'s own points, nor for a circle', () => {
    const doc = arcWithMiddle([0, 0], 10, 0, Math.PI, [0, 10]);
    const g = solve(doc).geometry;
    expect(applicableRelations(g, ['m', 'A']).map((r) => r.type)).toEqual(['pointOnCurve', 'midpoint']);
    expect(applicableRelations(g, ['s', 'A']).map((r) => r.type)).toEqual(['pointOnCurve']);
    const circle = start([{ id: 'c', type: 'point', x: 0, y: 0 }, { id: 'C', type: 'circle', center: 'c', radius: 5 }, { id: 'm', type: 'point', x: 5, y: 0 }]);
    expect(applicableRelations(solve(circle).geometry, ['m', 'C']).map((r) => r.type)).toEqual(['pointOnCurve']);
  });

  it('fuzz (200 arcs): after a large change of the arc the point is at the middle of the new sweep, never at the middle of the rest of the circle', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const deg = Math.PI / 180;
    const misses: unknown[] = [];
    for (let i = 0; i < 200; i++) {
      const c: [number, number] = [(rnd() - 0.5) * 200, (rnd() - 0.5) * 200];
      const r = 1 + rnd() * 99;
      const a0 = rnd() * 2 * Math.PI;
      const sweep = (10 + rnd() * 340) * deg;
      // the arc as it was, and the point at its middle
      const before = solve(arcWithMiddle(c, r, a0, sweep, polar(c, r, a0 + sweep / 2)));
      const was = pointAt(before, 'm');
      // the arc changed a lot: radius ×0.5…2, the start turned by up to 60°, the sweep by up to 60° (kept within 10°…350°)
      const r2 = r * (0.5 + rnd() * 1.5);
      const b0 = a0 + (rnd() - 0.5) * 120 * deg;
      const sweep2 = Math.min(350 * deg, Math.max(10 * deg, sweep + (rnd() - 0.5) * 120 * deg));
      const after = solve(arcWithMiddle(c, r2, b0, sweep2, was)); // the point starts where it was
      const arc = after.geometry.get('A');
      const m = after.status === 'failed' ? null : pointAt(after, 'm');
      const want = arc?.type === 'arc' ? arcMidpoint(arc) : null;
      const off = m && want ? Math.hypot(m[0] - want[0], m[1] - want[1]) : Infinity;
      if (after.status !== 'fully' || off > 1e-6 * Math.max(1, r2)) misses.push({ i, status: after.status, off, r, r2, sweep: sweep / deg, sweep2: sweep2 / deg, turn: (b0 - a0) / deg });
    }
    expect(misses).toEqual([]);
  });
});
