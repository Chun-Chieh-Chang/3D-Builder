import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, resolveSketch, SKETCH_ORIGIN, type Command, type DimensionConstraint, type PartDoc, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver, type SolvedSketch } from '../src/index';
import { applicableRelations, dimensionText, measure, measuredText } from '../src/interact';
import { mergePoints, type OpResult } from '../src/ops';

let solver: PlaneGcsSolver;
beforeAll(async () => {
  solver = await PlaneGcsSolver.create();
});

const EMPTY: Command = {
  type: 'insertFeature',
  index: 0,
  feature: { id: 's1', type: 'sketch', name: '草圖1', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] },
};
const start = (entities: SketchEntity[] = [], constraints: SketchConstraint[] = []): PartDoc => applyCommand(applyCommand(createEmptyPart(), EMPTY), { type: 'addSketchItems', featureId: 's1', entities, constraints });
const sketchOf = (doc: PartDoc) => doc.features.find((f) => f.id === 's1') as SketchFeature;
const solve = (doc: PartDoc): SolvedSketch => solver.solve(resolveSketch(sketchOf(doc), doc), { analyze: true });
const point = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const at = (s: SolvedSketch, id: string) => {
  const g = s.geometry.get(id);
  if (g?.type !== 'point') throw new Error(`no point ${id}`);
  return g.p.map((v) => Math.round(v * 1e6) / 1e6);
};
const run = (doc: PartDoc, r: OpResult): PartDoc => {
  if ('error' in r) throw new Error(r.error);
  return applyCommand(doc, { type: 'editSketch', featureId: 's1', ...r.edit });
};

describe('coradial (C1.26)', () => {
  const circles = (...more: SketchConstraint[]) =>
    start(
      [point('c1', 0, 0), point('c2', 7, 3), { id: 'A', type: 'circle', center: 'c1', radius: 5 }, { id: 'B', type: 'circle', center: 'c2', radius: 2 }],
      [{ id: 'f', type: 'coincident', a: 'c1', b: SKETCH_ORIGIN }, { id: 'r', type: 'radius', circle: 'A', value: '5' }, ...more],
    );

  it('puts the second circle on the first: same center, same radius, and nothing is left over', () => {
    const doc = circles({ id: 'k', type: 'coradial', a: 'A', b: 'B' });
    const s = solve(doc);
    expect(s.status).toBe('fully');
    expect(s.redundant).toEqual([]);
    expect(at(s, 'c2')).toEqual([0, 0]);
    expect(s.geometry.get('B')).toMatchObject({ r: expect.closeTo(5, 6) });
  });

  it('works between a circle and an arc, and is offered for two circles or arcs', () => {
    const doc = start(
      [point('c1', 0, 0), point('c2', 4, 4), point('s', 9, 4), point('e', 4, 9), { id: 'A', type: 'circle', center: 'c1', radius: 5 }, { id: 'R', type: 'arc', center: 'c2', start: 's', end: 'e' }],
      [{ id: 'f', type: 'coincident', a: 'c1', b: SKETCH_ORIGIN }, { id: 'r', type: 'radius', circle: 'A', value: '5' }, { id: 'k', type: 'coradial', a: 'A', b: 'R' }],
    );
    const s = solve(doc);
    expect(s.conflicting).toEqual([]);
    expect(at(s, 'c2')).toEqual([0, 0]);
    expect(applicableRelations(s.geometry, ['A', 'R']).map((r) => r.type)).toContain('coradial');
  });
});

describe('intersection (C1.26)', () => {
  const crossing = () =>
    start(
      [point('a', -10, 0), point('b', 10, 2), point('c', 3, -8), point('d', 4, 9), { id: 'L', type: 'line', p1: 'a', p2: 'b' }, { id: 'M', type: 'line', p1: 'c', p2: 'd' }, point('x', 0, 0)],
      [
        { id: 'f1', type: 'fix', point: 'a' }, { id: 'f2', type: 'fix', point: 'b' }, { id: 'f3', type: 'fix', point: 'c' }, { id: 'f4', type: 'fix', point: 'd' },
        { id: 'k', type: 'intersection', point: 'x', a: 'L', b: 'M' },
      ],
    );

  it('places the point where the two lines cross (hand-calculated) and fully defines it', () => {
    const s = solve(crossing());
    // L: y = 0.1 (x + 10); M: x = 3 + (y + 8) / 17
    const [px, py] = at(s, 'x');
    expect(py!).toBeCloseTo(0.1 * (px! + 10), 5); // on L
    expect(px!).toBeCloseTo(3 + (py! + 8) / 17, 5); // on M
    expect(s.status).toBe('fully');
    expect(s.redundant).toEqual([]);
  });

  it('brings the point to the crossing of two free lines and leaves the lines where they are (C6.2)', () => {
    // the check found: L and M drawn crossing at (1, 0.5), a point drawn far away, nothing else defined.
    // The solver starts the point at the crossing, so it does not have to pull the sketch onto the point.
    const doc = start(
      [point('a', -10, -5), point('b', 10, 5), point('c', -10, 6), point('d', 10, -4), { id: 'L', type: 'line', p1: 'a', p2: 'b' }, { id: 'M', type: 'line', p1: 'c', p2: 'd' }, point('x', 20, 20)],
      [{ id: 'k', type: 'intersection', point: 'x', a: 'L', b: 'M' }],
    );
    const s = solve(doc);
    expect(at(s, 'x')).toEqual([1, 0.5]);
    for (const [id, where] of [
      ['a', [-10, -5]],
      ['b', [10, 5]],
      ['c', [-10, 6]],
      ['d', [10, -4]],
    ] as const) {
      expect(at(s, id)).toEqual([...where]);
    }
  });

  it('is offered for a point and two curves, and works with a circle', () => {
    const s = solve(crossing());
    expect(applicableRelations(s.geometry, ['x', 'L', 'M']).map((r) => r.type)).toEqual(['intersection']);
    const doc = start(
      [point('c', 0, 0), { id: 'C', type: 'circle', center: 'c', radius: 5 }, point('a', -10, 0), point('b', 10, 0), { id: 'L', type: 'line', p1: 'a', p2: 'b' }, point('x', 4, 1)],
      [{ id: 'f', type: 'coincident', a: 'c', b: SKETCH_ORIGIN }, { id: 'r', type: 'radius', circle: 'C', value: '5' }, { id: 'h', type: 'horizontal', a: 'L' }, { id: 'k', type: 'intersection', point: 'x', a: 'C', b: 'L' }, { id: 'fa', type: 'fix', point: 'a' }],
    );
    const t = solve(doc);
    expect(Math.hypot(...(at(t, 'x') as [number, number]))).toBeCloseTo(5, 5);
    expect(at(t, 'x')[1]).toBeCloseTo(0, 5);
  });
});

describe('arc length (C1.28)', () => {
  const arc = (value: string, driving?: boolean) =>
    start(
      [point('c', 0, 0), point('s', 10, 0), point('e', 0, 10), { id: 'A', type: 'arc', center: 'c', start: 's', end: 'e' }],
      [
        { id: 'f', type: 'coincident', a: 'c', b: SKETCH_ORIGIN },
        { id: 'h', type: 'horizontal', a: 'c', b: 's' },
        { id: 'r', type: 'radius', circle: 'A', value: '10' },
        { id: 'l', type: 'arcLength', circle: 'A', value, ...(driving === undefined ? {} : { driving }) },
      ],
    );

  it('sets the sweep: a length of 10π/2 on radius 10 is a quarter circle, one of 10π a half', () => {
    for (const [length, angle] of [[(10 * Math.PI) / 2, 90], [10 * Math.PI, 180]] as const) {
      const s = solve(arc(String(length)));
      expect(s.status).toBe('fully');
      const g = s.geometry.get('A')!;
      expect(g.type === 'arc' && Math.round((((g.a1 - g.a0 + 2 * Math.PI) % (2 * Math.PI)) * 180) / Math.PI * 1e4) / 1e4).toBe(angle);
    }
  });

  it('is measured from the solved arc, in every kind of dimension', () => {
    const s = solve(arc(String((10 * Math.PI) / 2)));
    const c = sketchOf(arc('1')).constraints.find((k) => k.id === 'l') as DimensionConstraint;
    expect(measure(c, s.geometry)).toBeCloseTo((10 * Math.PI) / 2, 6);
    expect(measure({ id: 'x', type: 'radius', circle: 'A', value: '0' }, s.geometry)).toBeCloseTo(10, 6);
    expect(measure({ id: 'x', type: 'diameter', circle: 'A', value: '0' }, s.geometry)).toBeCloseTo(20, 6);
    expect(measure({ id: 'x', type: 'distance', a: 'c', b: 's', value: '0' }, s.geometry)).toBeCloseTo(10, 6);
    expect(measure({ id: 'x', type: 'distanceX', a: 'c', b: 'e', value: '0' }, s.geometry)).toBeCloseTo(0, 6);
    expect(measure({ id: 'x', type: 'distanceY', a: 'c', b: 'e', value: '0' }, s.geometry)).toBeCloseTo(10, 6);
    expect(measure({ id: 'x', type: 'distance', a: 'ghost', value: '0' }, s.geometry)).toBeNull();
  });

  it('measures lines: length, parallel distance, point to line, angle', () => {
    const doc = start([point('a', 0, 0), point('b', 6, 0), point('c', 0, 4), point('d', 6, 4), point('e', 0, 0.001), { id: 'L', type: 'line', p1: 'a', p2: 'b' }, { id: 'M', type: 'line', p1: 'c', p2: 'd' }, point('p', 2, 3), point('u', 1, 1), point('v', 4, 4), { id: 'N', type: 'line', p1: 'u', p2: 'v' }]);
    const g = solve(doc).geometry;
    const dim = (body: object) => body as DimensionConstraint;
    expect(measure(dim({ id: 'x', type: 'distance', a: 'L', value: '0' }), g)).toBeCloseTo(6, 6);
    expect(measure(dim({ id: 'x', type: 'distance', a: 'L', b: 'M', value: '0' }), g)).toBeCloseTo(4, 6);
    expect(measure(dim({ id: 'x', type: 'distance', a: 'p', b: 'L', value: '0' }), g)).toBeCloseTo(3, 6);
    expect(measure(dim({ id: 'x', type: 'angle', a: 'L', b: 'N', value: '0' }), g)).toBeCloseTo(45, 6);
  });
});

describe('driven dimensions (C1.29)', () => {
  const rectangle = (driving?: boolean) =>
    start(
      [point('p0', 0, 0), point('p1', 30, 0), point('p2', 30, 20), point('p3', 0, 20), { id: 'l0', type: 'line', p1: 'p0', p2: 'p1' }, { id: 'l1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'l2', type: 'line', p1: 'p2', p2: 'p3' }, { id: 'l3', type: 'line', p1: 'p3', p2: 'p0' }],
      [
        { id: 'h0', type: 'horizontal', a: 'l0' }, { id: 'v1', type: 'vertical', a: 'l1' }, { id: 'h2', type: 'horizontal', a: 'l2' }, { id: 'v3', type: 'vertical', a: 'l3' },
        { id: 'c', type: 'coincident', a: 'p0', b: SKETCH_ORIGIN }, { id: 'w', type: 'distance', a: 'l0', value: '30' }, { id: 'h', type: 'distance', a: 'l1', value: '20' },
        // a third dimension, which the sketch is already defined without
        { id: 'top', type: 'distance', a: 'l2', value: '99', ...(driving === undefined ? {} : { driving }) },
      ],
    );

  it('a dimension that would over-define is a conflict while it drives, and harmless as a reference that shows the measured 30', () => {
    expect(solve(rectangle()).status).toBe('over');
    const s = solve(rectangle(false));
    expect(s.status).toBe('fully');
    expect(s.redundant).toEqual([]);
    const top = sketchOf(rectangle(false)).constraints.find((k) => k.id === 'top') as DimensionConstraint;
    expect(measuredText(top, s.geometry)).toBe('30');
    expect(dimensionText(top, '30')).toBe('(30)'); // a reference is in parentheses, with the measured value, not the stored one
    expect(dimensionText({ ...top, driving: undefined } as DimensionConstraint, '30')).toBe('99');
  });

  it('turns a dimension into a reference and back with one command each, and takes the measured value when it drives again', () => {
    let doc = rectangle(false);
    doc = applyCommand(doc, { type: 'setDimensionDriving', featureId: 's1', constraintId: 'w', driving: false });
    expect(sketchOf(doc).constraints.find((k) => k.id === 'w')).toMatchObject({ driving: false });
    expect(solve(doc).status).toBe('under'); // the width is free now
    doc = applyCommand(doc, { type: 'setDimensionDriving', featureId: 's1', constraintId: 'w', driving: true, value: '30' });
    expect('driving' in sketchOf(doc).constraints.find((k) => k.id === 'w')!).toBe(false);
  });

  it('refuses to make a dimension a reference while an expression still uses it, and says which', () => {
    let doc = rectangle();
    doc = applyCommand(doc, { type: 'setDimension', featureId: 's1', constraintId: 'h', value: 'w@草圖1 * 2 / 3' });
    expect(() => applyCommand(doc, { type: 'setDimensionDriving', featureId: 's1', constraintId: 'w', driving: false })).toThrow('正被運算式使用');
    expect(() => applyCommand(doc, { type: 'setDimensionDriving', featureId: 's1', constraintId: 'nothing', driving: false })).toThrow('找不到尺寸');
  });
});

describe('merge (C1.26)', () => {
  const two = () =>
    start(
      [point('a', 0, 0), point('b', 10, 0), point('c', 10.5, 0.2), point('d', 10, 8), { id: 'L', type: 'line', p1: 'a', p2: 'b' }, { id: 'M', type: 'line', p1: 'c', p2: 'd' }],
      [{ id: 'k1', type: 'horizontal', a: 'L' }, { id: 'k2', type: 'coincident', a: 'b', b: 'c' }, { id: 'k3', type: 'vertical', a: 'M' }, { id: 'k4', type: 'pointOnCurve', point: 'c', curve: 'L' }],
    );

  it('makes two points one: the lines now meet at the first, what hung on the second hangs on it, and the coincidence between them is gone', () => {
    const doc = run(two(), mergePoints(sketchOf(two()), 'b', 'c'));
    const sk = sketchOf(doc);
    expect(sk.entities.some((e) => e.id === 'c')).toBe(false);
    expect(sk.entities.find((e) => e.id === 'M')).toMatchObject({ p1: 'b', p2: 'd' });
    expect(sk.constraints.some((k) => k.id === 'k2')).toBe(false); // coincident b–c
    expect(sk.constraints.some((k) => k.id === 'k4')).toBe(false); // b on its own line says nothing: gone, else the solver calls it redundant
    const s = solve(doc);
    expect([s.conflicting, s.redundant]).toEqual([[], []]);
  });

  it('a line ending on an arc and the arc starting on the line, made one corner: neither "on" stays, and the sketch is not over-defined (零件1, B1)', () => {
    const arcCorner = () =>
      start(
        [
          point('o', 0, 0), point('s', 3, 0), point('e', 0, 3), point('top', 3, 5), point('end', 3.0000000001, 0.0000000001),
          { id: 'A', type: 'arc', center: 'o', start: 's', end: 'e' },
          { id: 'L', type: 'line', p1: 'end', p2: 'top' },
        ],
        [
          { id: 'c', type: 'coincident', a: 'o', b: SKETCH_ORIGIN },
          { id: 'r', type: 'radius', circle: 'A', value: '3' },
          { id: 'v', type: 'vertical', a: 'L' },
          { id: 'h', type: 'horizontal', a: 'o', b: 's' },
          { id: 'onArc', type: 'pointOnCurve', point: 'end', curve: 'A' },
          { id: 'onLine', type: 'pointOnCurve', point: 's', curve: 'L' },
        ],
      );
    const doc = run(arcCorner(), mergePoints(sketchOf(arcCorner()), 'end', 's'));
    const sk = sketchOf(doc);
    expect(sk.entities.find((e) => e.id === 'A')).toMatchObject({ start: 'end' });
    expect(sk.constraints.map((k) => k.id).sort()).toEqual(['c', 'h', 'r', 'v']); // the corner is the start of the arc and the end of the line
    const s = solve(doc);
    expect([s.conflicting, s.redundant]).toEqual([[], []]);
  });

  it('says no to the origin, a point with itself, a line collapsed to a point and a dimension between the two', () => {
    const doc = start([point('a', 0, 0), point('b', 5, 5), point('c', 9, 9), { id: 'L', type: 'line', p1: 'b', p2: 'c' }], [{ id: 'd', type: 'distance', a: 'a', b: 'b', value: '7' }]);
    expect(mergePoints(sketchOf(doc), 'b', 'b')).toMatchObject({ error: expect.stringContaining('兩個不同') });
    expect(mergePoints(sketchOf(doc), 'b', 'L')).toMatchObject({ error: expect.stringContaining('兩個不同') });
    expect(mergePoints(sketchOf(doc), 'b', 'c')).toMatchObject({ error: expect.stringContaining('沒有長度') });
    expect(mergePoints(sketchOf(doc), 'a', 'b')).toMatchObject({ error: expect.stringContaining('尺寸') });
    expect(mergePoints(sketchOf(doc), 'a', SKETCH_ORIGIN)).toMatchObject({ error: expect.stringContaining('原點') });
  });
});

describe('collinear lines that share an end (D5.3a)', () => {
  const chain = (...more: SketchConstraint[]) =>
    start(
      [point('a', 0, 0), point('b', 10, 5), point('c', 30, 17), { id: 'l1', type: 'line', p1: 'a', p2: 'b' }, { id: 'l2', type: 'line', p1: 'b', p2: 'c' }],
      [{ id: 'f', type: 'coincident', a: 'a', b: SKETCH_ORIGIN }, ...more],
    );

  it('are not reported redundant: the shared end is on the line already, so only the direction is asked', () => {
    const s = solve(chain({ id: 'k', type: 'collinear', a: 'l2', b: 'l1' }));
    expect(s.redundant).toEqual([]);
    expect(s.conflicting).toEqual([]);
    const [b, c] = [at(s, 'b'), at(s, 'c')];
    expect(Math.abs((c[1]! - b[1]!) * (b[0]! - 0) - (c[0]! - b[0]!) * (b[1]! - 0))).toBeLessThan(1e-4); // c, b, a on one line
  });

  it('still asks both ends when the lines are apart', () => {
    const doc = start(
      [point('a', 0, 0), point('b', 10, 5), point('c', 30, 20), point('d', 40, 27), { id: 'l1', type: 'line', p1: 'a', p2: 'b' }, { id: 'l2', type: 'line', p1: 'c', p2: 'd' }],
      [{ id: 'f', type: 'coincident', a: 'a', b: SKETCH_ORIGIN }, { id: 'k', type: 'collinear', a: 'l2', b: 'l1' }],
    );
    const s = solve(doc);
    expect(s.redundant).toEqual([]);
    const [a, b, c, d] = [at(s, 'a'), at(s, 'b'), at(s, 'c'), at(s, 'd')];
    const side = (p: number[]) => (b[0]! - a[0]!) * (p[1]! - a[1]!) - (b[1]! - a[1]!) * (p[0]! - a[0]!);
    expect(Math.abs(side(c!))).toBeLessThan(1e-4); // all four on one line
    expect(Math.abs(side(d!))).toBeLessThan(1e-4);
  });
});
