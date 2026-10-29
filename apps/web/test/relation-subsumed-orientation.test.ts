/**
 * ADR 0217: 「共線」 between a line that is 「水平」 and a horizontal outline of the model (fixed, as every entity that follows the model is) over-defines the
 * sketch, and the solver blames the new relation, so it could never be added. The line's own horizontal is redundant and is replaced, in one step; a
 * relation that would turn the line is a conflict and is still refused. Real PlaneGCS, no mocks.
 */
import { beforeAll, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, DocHistory, resolveSketch, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { SketchController, type SketchHost } from '../src/sketcher/controller';

let solver: PlaneGcsSolver;
beforeAll(async () => {
  solver = await PlaneGcsSolver.create();
});

function host(entities: SketchEntity[], constraints: SketchConstraint[]) {
  const feature: SketchFeature = { id: 'sketch', type: 'sketch', name: 'outline', suppressed: false, plane: { kind: 'datum', name: 'plane:right' }, entities, constraints };
  const history = new DocHistory(applyCommand(createEmptyPart(), { type: 'insertFeature', index: 0, feature }));
  const sketch = () => history.doc.features[0] as SketchFeature;
  const solve = (s = sketch()) => ({ ...solver.solve(resolveSketch(s, history.doc), { analyze: true }), seq: 0, ms: 0, problems: [] });
  const notices: { text: string; kind?: string }[] = [];
  const h: SketchHost = { featureId: feature.id, doc: () => history.doc, solved: () => solve(), execute: (c) => { history.execute(c); return true; }, trial: async (s) => solve(s), dragPreview: () => {}, notify: (text, kind) => void notices.push({ text, kind }), editDimension: () => {} };
  return { history, sketch, solve, notices, controller: new SketchController(h) };
}

/** A fixed line from (x1, y1) to (x2, y2), as an outline of the model is to the solver: construction, both ends held. */
const held = (id: string, x1: number, y1: number, x2: number, y2: number) => ({
  entities: [
    { id: `${id}a`, type: 'point', x: x1, y: y1 },
    { id: `${id}b`, type: 'point', x: x2, y: y2 },
    { id, type: 'line', p1: `${id}a`, p2: `${id}b`, construction: true },
  ] as SketchEntity[],
  constraints: [
    { id: `${id}fa`, type: 'fix', point: `${id}a` },
    { id: `${id}fb`, type: 'fix', point: `${id}b` },
  ] as SketchConstraint[],
});
/** A free line from (x1, y1) to (x2, y2) with only `orientation` (if any) on it. */
const loose = (id: string, x1: number, y1: number, x2: number, y2: number, orientation?: 'horizontal' | 'vertical') => ({
  entities: [
    { id: `${id}a`, type: 'point', x: x1, y: y1 },
    { id: `${id}b`, type: 'point', x: x2, y: y2 },
    { id, type: 'line', p1: `${id}a`, p2: `${id}b` },
  ] as SketchEntity[],
  constraints: (orientation ? [{ id: `${id}o`, type: orientation, a: id }] : []) as SketchConstraint[],
});
const join = (...parts: { entities: SketchEntity[]; constraints: SketchConstraint[] }[]) => ({ entities: parts.flatMap((p) => p.entities), constraints: parts.flatMap((p) => p.constraints) });
const lineOf = (h: ReturnType<typeof host>, id: string) => {
  const g = h.solve().geometry.get(id);
  if (g?.type !== 'line') throw new Error(`${id} is not a line`);
  return g;
};

it('the report: 水平 l3 just above a horizontal outline; 「共線」 replaces its 水平 in one step, lies on it, and one undo brings it back', async () => {
  const f = join(held('ref', 0, 5, 20, 5), loose('l3', 2, 6, 12, 6, 'horizontal'));
  const h = host(f.entities, f.constraints);
  const before = h.history.doc;
  h.controller.select(['l3', 'ref']);
  expect(await h.controller.addRelation({ type: 'collinear', a: 'l3', b: 'ref' })).toBe(true);
  expect(h.sketch().constraints.map((c) => c.type).sort()).toEqual(['collinear', 'fix', 'fix']);
  const r = h.solve();
  expect(r.status).not.toBe('over');
  expect(r.redundant).toEqual([]);
  const l3 = lineOf(h, 'l3');
  expect(l3.a[1]).toBeCloseTo(5, 9);
  expect(l3.b[1]).toBeCloseTo(5, 9);
  expect(h.notices).toEqual([{ text: expect.stringContaining('水平'), kind: 'info' }]);
  h.history.undo();
  expect(h.history.doc).toEqual(before);
});

it('「平行」 to a horizontal outline replaces the line’s own 水平 the same way, and the line stays where it was', async () => {
  const f = join(held('ref', 0, 5, 20, 5), loose('l3', 2, 6, 12, 6, 'horizontal'));
  const h = host(f.entities, f.constraints);
  h.controller.select(['l3', 'ref']);
  expect(await h.controller.addRelation({ type: 'parallel', a: 'l3', b: 'ref' })).toBe(true);
  expect(h.sketch().constraints.some((c) => c.type === 'horizontal')).toBe(false);
  expect(h.sketch().constraints.some((c) => c.type === 'parallel')).toBe(true);
  const l3 = lineOf(h, 'l3');
  expect(l3.a[1]).toBeCloseTo(l3.b[1], 9);
});

it('two horizontal lines made collinear: only one 水平 goes, both stay horizontal', async () => {
  const f = join(loose('l3', 2, 6, 12, 6, 'horizontal'), loose('l4', 20, 8, 30, 8, 'horizontal'));
  const h = host(f.entities, f.constraints);
  h.controller.select(['l3', 'l4']);
  expect(await h.controller.addRelation({ type: 'collinear', a: 'l3', b: 'l4' })).toBe(true);
  expect(h.sketch().constraints.filter((c) => c.type === 'horizontal')).toHaveLength(1);
  // one solve for both: with nothing holding their height, two solves may put them at different heights
  const g = h.solve().geometry;
  const [l3, l4] = ['l3', 'l4'].map((id) => g.get(id)) as Extract<(typeof g extends Map<string, infer V> ? V : never), { type: 'line' }>[];
  for (const l of [l3!, l4!]) expect(l.a[1]).toBeCloseTo(l.b[1], 9);
  expect(l3!.a[1]).toBeCloseTo(l4!.a[1], 9);
});

it('a 水平 line 10 long made parallel to a slanted outline is a conflict: removing its 水平 would turn it, so it is refused and nothing changes', async () => {
  const f = join(held('ref', 0, 5, 20, 12), loose('l3', 2, 6, 12, 6, 'horizontal'));
  const h = host(f.entities, [...f.constraints, { id: 'len', type: 'distance', a: 'l3', value: '10' }]);
  const before = h.history.doc;
  h.controller.select(['l3', 'ref']);
  // the removal alone solves — with l3 turned onto the slant, which is why the direction is checked and not only the status
  const without = h.solve({ ...h.sketch(), constraints: [...h.sketch().constraints.filter((c) => c.id !== 'l3o'), { id: 'x', type: 'parallel', a: 'l3', b: 'ref' }] });
  expect(without.status).not.toBe('over');
  const turned = without.geometry.get('l3');
  expect(turned?.type === 'line' && Math.abs(turned.b[1] - turned.a[1])).toBeGreaterThan(1);
  expect(await h.controller.addRelation({ type: 'parallel', a: 'l3', b: 'ref' })).toBe(false);
  expect(h.history.doc).toBe(before);
  expect(h.notices.map((n) => n.kind)).toEqual(['error']);
});

it('over-defined for another reason (the line’s height is dimensioned elsewhere): refused, its 水平 is kept', async () => {
  const f = join(held('ref', 0, 5, 20, 5), loose('l3', 2, 6, 12, 6, 'horizontal'));
  const h = host(f.entities, [...f.constraints, { id: 'dy', type: 'distanceY', a: '@origin', b: 'l3a', value: '6' }]);
  const before = h.history.doc;
  h.controller.select(['l3', 'ref']);
  expect(await h.controller.addRelation({ type: 'collinear', a: 'l3', b: 'ref' })).toBe(false);
  expect(h.history.doc).toBe(before);
  expect(h.sketch().constraints.some((c) => c.id === 'l3o')).toBe(true);
});

it('fuzz: 100 outlines at random heights and sides, horizontal or vertical, each with a line just off it: always replaced, always on it', async () => {
  let seed = 211027;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 100; i++) {
    const at = (rand() - 0.5) * 2000;
    const gap = (rand() < 0.5 ? -1 : 1) * (0.001 + rand() * 50);
    const start = (rand() - 0.5) * 100;
    const length = 0.1 + rand() * 100;
    const vertical = i % 2 === 1;
    const f = vertical
      ? join(held('ref', at, start, at, start + length), loose('l3', at + gap, start + 1, at + gap, start + 1 + length, 'vertical'))
      : join(held('ref', start, at, start + length, at), loose('l3', start + 1, at + gap, start + 1 + length, at + gap, 'horizontal'));
    const h = host(f.entities, f.constraints);
    h.controller.select(['l3', 'ref']);
    expect(await h.controller.addRelation({ type: 'collinear', a: 'l3', b: 'ref' }), `case ${i}`).toBe(true);
    const l3 = lineOf(h, 'l3');
    const k = vertical ? 0 : 1;
    expect(l3.a[k], `case ${i}`).toBeCloseTo(at, 7);
    expect(l3.b[k], `case ${i}`).toBeCloseTo(at, 7);
  }
});
