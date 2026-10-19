import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, IdAllocator, idsInUse, resolveSketch, SKETCH_AXIS_H, SKETCH_AXIS_V, SKETCH_ORIGIN, sketchError, type Command, type PartDoc, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver, type SolvedSketch } from '../src/index';
import { applicableRelations, hitTest, layoutDimension, measure, smartDimension, snap } from '../src/interact';
import { mirror } from '../src/ops';

/** The sketch's two axes (ADR 0170): fixed infinite lines through the origin that relations and dimensions may refer to. */

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
const line = (id: string, p1: string, p2: string): SketchEntity => ({ id, type: 'line', p1, p2 });
const at = (s: SolvedSketch, id: string) => {
  const g = s.geometry.get(id);
  if (g?.type !== 'point') throw new Error(`no point ${id}`);
  return g.p;
};

describe('relations to the sketch axes (solver)', () => {
  it('symmetric about the vertical axis: a point mirrors its twin across x = 0, with no centerline drawn', () => {
    const s = solve(start([point('a', 7, 3), point('b', -4, 5)], [{ id: 'f', type: 'fix', point: 'a' }, { id: 'k', type: 'symmetric', a: 'a', b: 'b', axis: SKETCH_AXIS_V }]));
    expect(s.status).toBe('fully');
    expect(at(s, 'b')[0]).toBeCloseTo(-7, 9);
    expect(at(s, 'b')[1]).toBeCloseTo(3, 9);
    // the axes are not geometry of the sketch: nothing new to draw or to make a profile of
    expect([...s.geometry.keys()].some((id) => id.startsWith('@'))).toBe(false);
  });

  it('point on the horizontal axis takes one freedom (y = 0)', () => {
    const s = solve(start([point('p', 4, 2.5)], [{ id: 'k', type: 'pointOnCurve', point: 'p', curve: SKETCH_AXIS_H }]));
    expect(s.dof).toBe(1);
    expect(at(s, 'p')[1]).toBeCloseTo(0, 9);
  });

  it('the angle of one line against the horizontal axis (no second line needed)', () => {
    const s = solve(
      start([point('a', 0, 0), point('b', 10, 3), line('L', 'a', 'b')], [
        { id: 'o', type: 'coincident', a: 'a', b: SKETCH_ORIGIN },
        { id: 'n', type: 'distance', a: 'L', value: '20' },
        { id: 'g', type: 'angle', a: SKETCH_AXIS_H, b: 'L', value: '30deg' },
      ]),
    );
    expect(s.status).toBe('fully');
    expect(at(s, 'b')[0]).toBeCloseTo(20 * Math.cos(Math.PI / 6), 9);
    expect(at(s, 'b')[1]).toBeCloseTo(10, 9);
  });

  it('distance from a circle center to the vertical axis, and the circle tangent to the horizontal axis', () => {
    const s = solve(
      start([point('c', 12, 7), { id: 'C', type: 'circle', center: 'c', radius: 4 }], [
        { id: 'd', type: 'distance', a: 'C', b: SKETCH_AXIS_V, value: '15' },
        { id: 'r', type: 'radius', circle: 'C', value: '6' },
        { id: 't', type: 'tangent', a: SKETCH_AXIS_H, b: 'C' },
      ]),
    );
    expect(s.status).toBe('fully');
    expect(at(s, 'c')[0]).toBeCloseTo(15, 9);
    expect(at(s, 'c')[1]).toBeCloseTo(6, 9);
  });

  it('collinear with the horizontal axis puts both ends on y = 0; perpendicular to it makes a line vertical', () => {
    const s = solve(
      start([point('a', 1, 1), point('b', 9, 2), line('L', 'a', 'b'), point('c', 3, 4), point('d', 5, 9), line('M', 'c', 'd')], [
        { id: 'k', type: 'collinear', a: 'L', b: SKETCH_AXIS_H },
        { id: 'p', type: 'perpendicular', a: 'M', b: SKETCH_AXIS_H },
      ]),
    );
    expect(s.conflicting).toEqual([]);
    expect(at(s, 'a')[1]).toBeCloseTo(0, 9);
    expect(at(s, 'b')[1]).toBeCloseTo(0, 9);
    expect(at(s, 'c')[0]).toBeCloseTo(at(s, 'd')[0], 9);
  });

  it('a point where a circle crosses the vertical axis starts on the crossing nearest where it was drawn', () => {
    const s = solve(
      start([point('c', 3, 0), { id: 'C', type: 'circle', center: 'c', radius: 5 }, point('x', 0.5, -3.5)], [
        { id: 'f', type: 'fix', point: 'c' },
        { id: 'r', type: 'radius', circle: 'C', value: '5' },
        { id: 'k', type: 'intersection', point: 'x', a: 'C', b: SKETCH_AXIS_V },
      ]),
    );
    expect(s.status).toBe('fully');
    expect(at(s, 'x')[0]).toBeCloseTo(0, 9);
    expect(at(s, 'x')[1]).toBeCloseTo(-4, 9);
  });

  it('a relation the axis already makes is reported redundant by its own id, never by an axis', () => {
    const s = solve(
      start([point('a', 1, 0), point('b', 9, 0.2), line('L', 'a', 'b')], [
        { id: 'h', type: 'horizontal', a: 'L' },
        { id: 'p', type: 'parallel', a: 'L', b: SKETCH_AXIS_H },
      ]),
    );
    expect(s.status).toBe('over');
    expect([...s.redundant, ...s.conflicting].every((id) => !id.startsWith('@'))).toBe(true);
    expect([...s.redundant, ...s.conflicting].length).toBeGreaterThan(0);
  });

  it('fuzz: 200 random symmetric pairs about each axis land exactly mirrored', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 200 - 100;
    for (let i = 0; i < 200; i++) {
      const axis = i % 2 ? SKETCH_AXIS_H : SKETCH_AXIS_V;
      const [x, y, u, v] = [rnd(), rnd(), rnd(), rnd()];
      const s = solve(start([point('a', x, y), point('b', u, v)], [{ id: 'f', type: 'fix', point: 'a' }, { id: 'k', type: 'symmetric', a: 'a', b: 'b', axis }]));
      expect(s.status).toBe('fully');
      const b = at(s, 'b');
      const want = axis === SKETCH_AXIS_V ? [-x, y] : [x, -y];
      expect(Math.hypot(b[0] - want[0]!, b[1] - want[1]!)).toBeLessThan(1e-8);
    }
  });
});

describe('what may refer to an axis (rules)', () => {
  const err = (c: SketchConstraint, entities: SketchEntity[] = [point('a', 1, 1), point('b', 5, 2), line('L', 'a', 'b'), point('c', 2, 2), { id: 'C', type: 'circle', center: 'c', radius: 1 }]) =>
    sketchError({ entities, constraints: [c] });

  it('accepts the relations a fixed infinite line means something for', () => {
    for (const c of [
      { id: 'k', type: 'collinear', a: 'L', b: SKETCH_AXIS_H },
      { id: 'k', type: 'parallel', a: SKETCH_AXIS_V, b: 'L' },
      { id: 'k', type: 'perpendicular', a: 'L', b: SKETCH_AXIS_V },
      { id: 'k', type: 'angle', a: SKETCH_AXIS_H, b: 'L', value: '10deg' },
      { id: 'k', type: 'symmetric', a: 'a', b: 'b', axis: SKETCH_AXIS_H },
      { id: 'k', type: 'pointOnCurve', point: 'a', curve: SKETCH_AXIS_V },
      { id: 'k', type: 'intersection', point: 'a', a: 'L', b: SKETCH_AXIS_V },
      { id: 'k', type: 'tangent', a: 'C', b: SKETCH_AXIS_H },
      { id: 'k', type: 'distance', a: 'a', b: SKETCH_AXIS_V, value: '3' },
      { id: 'k', type: 'distance', a: 'C', b: SKETCH_AXIS_H, value: '3' },
    ] as SketchConstraint[]) {
      expect(err(c), c.type).toBeNull();
    }
  });

  it('refuses, with a reason, what an axis cannot be: horizontal, equal, a middle, a length, an anchor, a pair of axes', () => {
    expect(err({ id: 'k', type: 'horizontal', a: SKETCH_AXIS_H })).toMatch(/@axisH/);
    expect(err({ id: 'k', type: 'vertical', a: SKETCH_AXIS_V })).toMatch(/@axisV/);
    expect(err({ id: 'k', type: 'equal', a: 'L', b: SKETCH_AXIS_H })).toMatch(/@axisH/);
    expect(err({ id: 'k', type: 'midpoint', point: 'a', line: SKETCH_AXIS_H })).toMatch(/@axisH/);
    expect(err({ id: 'k', type: 'distance', a: SKETCH_AXIS_H, value: '3' })).not.toBeNull();
    expect(err({ id: 'k', type: 'distanceX', a: SKETCH_AXIS_V, b: 'a', value: '3' })).toMatch(/@axisV/);
    expect(err({ id: 'k', type: 'tangent', a: 'L', b: SKETCH_AXIS_H })).not.toBeNull();
    expect(err({ id: 'k', type: 'perpendicular', a: SKETCH_AXIS_H, b: SKETCH_AXIS_V })).not.toBeNull();
    expect(err({ id: 'k', type: 'symmetric', a: 'a', b: 'b', axis: SKETCH_AXIS_H }, [point('a', 1, 1), point('b', 1, -1)])).toBeNull();
  });

  it('an entity or relation cannot take an axis id', () => {
    expect(sketchError({ entities: [point(SKETCH_AXIS_H, 0, 0)], constraints: [] })).not.toBeNull();
    expect(sketchError({ entities: [point('a', 0, 0)], constraints: [{ id: SKETCH_AXIS_V, type: 'fix', point: 'a' }] })).not.toBeNull();
  });
});

describe('picking, relations and dimensions with the axes (interaction)', () => {
  // solved geometry of a sketch with a line from (2, 3) to (8, 7) and a point at (5, -4)
  const geometry = () =>
    solve(start([point('a', 2, 3), point('b', 8, 7), line('L', 'a', 'b'), point('p', 5, -4)])).geometry;

  it('the cursor on an axis picks it, but anything the user drew near the cursor comes first', () => {
    const g = geometry();
    expect(hitTest(g, [40, 0.5], 1, undefined, true)).toMatchObject({ id: SKETCH_AXIS_H, kind: 'line' });
    expect(hitTest(g, [-0.3, -60], 1, undefined, true)).toMatchObject({ id: SKETCH_AXIS_V, kind: 'line' });
    expect(hitTest(g, [5, -3.6], 1, undefined, true)).toMatchObject({ id: 'p' }); // a point near the axis wins
    expect(hitTest(g, [0.3, 0.3], 1, undefined, true)).toMatchObject({ id: SKETCH_ORIGIN }); // the origin wins over both axes
    expect(hitTest(g, [40, 0.5], 1, new Set([SKETCH_AXIS_H]), true)).toBeNull();
  });

  it('drawing never snaps to an axis: an infinite line along y = 0 would take the place of horizontal and of model edges there', () => {
    const g = geometry();
    expect(hitTest(g, [40, 0.5], 1)).toBeNull();
    expect(snap(g, [40, 0.5], 1)).toMatchObject({ kind: 'free' });
  });

  it('offers only what an axis can be part of', () => {
    const g = geometry();
    const types = (sel: string[]) => applicableRelations(g, sel).map((r) => r.type).sort();
    expect(types(['L', SKETCH_AXIS_H])).toEqual(['collinear', 'parallel', 'perpendicular']);
    expect(types(['p', SKETCH_AXIS_V])).toEqual(['pointOnCurve']);
    expect(types(['a', 'p', SKETCH_AXIS_V])).toEqual(['symmetric']);
    expect(types([SKETCH_AXIS_H])).toEqual([]);
    expect(types([SKETCH_AXIS_H, SKETCH_AXIS_V])).toEqual([]);
    // whatever is offered, the rules accept
    const sk = sketchOf(start([point('a', 2, 3), point('b', 8, 7), line('L', 'a', 'b'), point('p', 5, -4)]));
    for (const r of applicableRelations(g, ['L', SKETCH_AXIS_H])) expect(sketchError({ ...sk, constraints: [{ id: 'k', ...r } as SketchConstraint] })).toBeNull();
  });

  it('smart dimension: point to axis, line to axis (angle); an axis alone or both axes give nothing', () => {
    const g = geometry();
    expect(smartDimension(g, ['p', SKETCH_AXIS_V], [3, -6])).toMatchObject({ body: { type: 'distance', a: 'p', b: SKETCH_AXIS_V }, value: 5 });
    expect(smartDimension(g, ['p', SKETCH_AXIS_H], [3, -6])?.value).toBeCloseTo(4, 12);
    const angle = smartDimension(g, ['L', SKETCH_AXIS_H], [9, 2]);
    expect(angle?.body.type).toBe('angle');
    expect(angle?.value).toBeCloseTo((Math.atan2(4, 6) * 180) / Math.PI, 9);
    expect(smartDimension(g, [SKETCH_AXIS_H], [3, 3])).toBeNull();
    expect(smartDimension(g, [SKETCH_AXIS_H, SKETCH_AXIS_V], [3, 3])).toBeNull();
  });

  it('a dimension to an axis is measured and laid out like one to a line', () => {
    const g = geometry();
    const d = { id: 'd', type: 'distance', a: 'p', b: SKETCH_AXIS_V, value: '5' } as const;
    expect(measure(d, g)).toBeCloseTo(5, 12);
    expect(layoutDimension(d, g, 0.1, [0, 0])).not.toBeNull();
  });

  it('mirror about the vertical axis: twins held symmetric about it, solved exactly', () => {
    let doc = start([point('a', 2, 3), point('b', 8, 7), line('L', 'a', 'b')], [{ id: 'fa', type: 'fix', point: 'a' }, { id: 'fb', type: 'fix', point: 'b' }]);
    const g = solve(doc).geometry;
    const r = mirror(sketchOf(doc), g, new IdAllocator(doc.idCounters, idsInUse(doc)), ['L'], SKETCH_AXIS_V);
    if ('error' in r) throw new Error(r.error);
    expect(r.edit.add?.constraints?.every((c) => c.type !== 'symmetric' || (c as { axis: string }).axis === SKETCH_AXIS_V)).toBe(true);
    doc = applyCommand(doc, { type: 'editSketch', featureId: 's1', ...r.edit });
    const s = solve(doc);
    expect(s.status).toBe('fully');
    const twins = [...s.geometry.values()].flatMap((x) => (x.type === 'point' && x.p[0] < 0 ? [x.p] : []));
    expect(twins.map((p) => [Math.round(p[0] * 1e9) / 1e9, Math.round(p[1] * 1e9) / 1e9]).sort()).toEqual([[-2, 3], [-8, 7]].sort());
  });
});
