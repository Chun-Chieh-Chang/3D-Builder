/**
 * A relation must not be met by shrinking a line, circle or arc to nothing (ADR 0211). Parallel, perpendicular, collinear, midpoint and the rest are met
 * just as well by a line of no length, and the solver, taking the shortest way, did exactly that and called it solved: a vertical line drawn first became
 * a point when a line was made parallel to it. Truth by hand: lines keep the length they had when the relation is met by turning them; a relation that
 * only a line of no length can meet (a line made horizontal and vertical, its two ends made one point) is refused, and says which one it would shrink.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { t } from '@3db/i18n';
import { applyCommand, createEmptyPart, resolveSketch, type Command, type PartDoc, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver, type SolvedSketch } from '../src/index';

let solver: PlaneGcsSolver;
beforeAll(async () => {
  solver = await PlaneGcsSolver.create();
});

const EMPTY: Command = {
  type: 'insertFeature',
  index: 0,
  feature: { id: 's1', type: 'sketch', name: '草圖1', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] },
};
const start = (entities: SketchEntity[], constraints: SketchConstraint[] = []): PartDoc =>
  applyCommand(applyCommand(createEmptyPart(), EMPTY), { type: 'addSketchItems', featureId: 's1', entities, constraints });
const sketchOf = (doc: PartDoc) => doc.features.find((f) => f.id === 's1') as SketchFeature;
const solve = (doc: PartDoc): SolvedSketch => solver.solve(resolveSketch(sketchOf(doc), doc), { analyze: true });
const line = (s: SolvedSketch, id: string) => {
  const g = s.geometry.get(id);
  if (g?.type !== 'line') throw new Error(`no line ${id}`);
  return g;
};
const length = (s: SolvedSketch, id: string) => Math.hypot(line(s, id).b[0] - line(s, id).a[0], line(s, id).b[1] - line(s, id).a[1]);
const cross = (s: SolvedSketch, a: string, b: string) => {
  const [u, v] = [line(s, a), line(s, b)];
  return (u.b[0] - u.a[0]) * (v.b[1] - v.a[1]) - (u.b[1] - u.a[1]) * (v.b[0] - v.a[0]);
};
const point = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const seg = (id: string, p1: string, p2: string): SketchEntity => ({ id, type: 'line', p1, p2 });

describe('a relation is met by turning, not by shrinking', () => {
  it('parallel: a vertical line of 25 and a slanted one of √(30² + 25²) sharing an end keep their lengths and end up parallel (the vertical line was shrunk to a point)', () => {
    const doc = start(
      [point('p1', -20, 5), point('p2', -20, -20), point('p3', 10, 5), seg('l1', 'p1', 'p2'), seg('l2', 'p2', 'p3')],
      [{ id: 'v', type: 'vertical', a: 'l1' }, { id: 'c', type: 'parallel', a: 'l1', b: 'l2' }],
    );
    const s = solve(doc);
    expect(s.status).not.toBe('failed');
    expect(s.status).not.toBe('over');
    expect(length(s, 'l1')).toBeCloseTo(25, 6);
    expect(length(s, 'l2')).toBeCloseTo(Math.hypot(30, 25), 6);
    expect(Math.abs(cross(s, 'l1', 'l2'))).toBeLessThan(1e-6);
    expect(line(s, 'l1').a[0]).toBeCloseTo(line(s, 'l1').b[0], 8); // and the vertical one is still vertical
  });

  it('vertical: a horizontal line of 15 sharing an end with a vertical line of 20 is made vertical and keeps its 15 (it was shrunk to a point)', () => {
    const doc = start(
      [point('p1', 20, -20), point('p2', 35, -20), point('p3', 35, -40), seg('l1', 'p1', 'p2'), seg('l2', 'p2', 'p3')],
      [{ id: 'v2', type: 'vertical', a: 'l2' }, { id: 'v1', type: 'vertical', a: 'l1' }],
    );
    const s = solve(doc);
    expect(s.status).not.toBe('failed');
    // both are vertical now and the 15 and the 20 are still there (where the shared end is, is for the sketch to say: nothing holds it)
    expect(length(s, 'l1')).toBeCloseTo(15, 6);
    expect(length(s, 'l2')).toBeCloseTo(20, 6);
    expect(line(s, 'l1').a[0]).toBeCloseTo(line(s, 'l1').b[0], 8);
    expect(line(s, 'l2').a[0]).toBeCloseTo(line(s, 'l2').b[0], 8);
  });

  it('perpendicular: two parallel vertical lines made perpendicular: one of them turns, neither shrinks', () => {
    const doc = start(
      [point('a', 10, 0), point('b', 10, 20), point('c', 30, 0), point('d', 30, 15), seg('L', 'a', 'b'), seg('M', 'c', 'd')],
      [{ id: 'p', type: 'perpendicular', a: 'L', b: 'M' }],
    );
    const s = solve(doc);
    expect(s.status).not.toBe('failed');
    expect(length(s, 'L')).toBeCloseTo(20, 6);
    expect(length(s, 'M')).toBeCloseTo(15, 6);
    const [u, v] = [line(s, 'L'), line(s, 'M')];
    expect((u.b[0] - u.a[0]) * (v.b[0] - v.a[0]) + (u.b[1] - u.a[1]) * (v.b[1] - v.a[1])).toBeCloseTo(0, 6);
  });

  it('collinear with a dimension along the line (the case that shrank M to a point): both keep their lengths', () => {
    const doc = start(
      [point('a', 10, 0), point('b', 10, 20), point('c', 30, 0), point('d', 30, 15), seg('L', 'a', 'b'), seg('M', 'c', 'd')],
      [{ id: 'k', type: 'collinear', a: 'L', b: 'M' }, { id: 'd1', type: 'distanceX', a: '@origin', b: 'a', value: '25' }],
    );
    const s = solve(doc);
    expect(s.status).not.toBe('failed');
    expect(length(s, 'L')).toBeCloseTo(20, 6);
    expect(length(s, 'M')).toBeCloseTo(15, 6);
    expect(Math.abs(cross(s, 'L', 'M'))).toBeLessThan(1e-6);
    expect(line(s, 'L').a[0]).toBeCloseTo(25, 6); // the dimension is met too
  });
});

describe('a relation only a line of no length can meet is refused, with the reason', () => {
  it('a line made horizontal and vertical', () => {
    const doc = start([point('a', 0, 0), point('b', 10, 0), seg('L', 'a', 'b')], [{ id: 'h', type: 'horizontal', a: 'L' }, { id: 'v', type: 'vertical', a: 'L' }]);
    const s = solve(doc);
    expect(s.status).toBe('failed');
    expect(s.collapsed).toEqual(['L']);
    expect(s.message).toBe(t('regen.sketchCollapsed', { names: 'L' }));
  });

  it('the two ends of a line made one point', () => {
    const doc = start([point('a', 0, 0), point('b', 10, 5), seg('L', 'a', 'b')], [{ id: 'c', type: 'coincident', a: 'a', b: 'b' }]);
    const s = solve(doc);
    expect(s.status).toBe('failed');
    expect(s.collapsed).toEqual(['L']);
  });

  it('a line that has no length to begin with is nobody\'s loss: a zero-length line stays as it is', () => {
    const doc = start([point('a', 3, 3), point('b', 3, 3), seg('L', 'a', 'b')], []);
    const s = solve(doc);
    expect(s.status).not.toBe('failed');
    expect(s.collapsed).toBeUndefined();
  });
});

describe('the sketch is as defined as it was: the guard leaves no trace in the degrees of freedom', () => {
  it('parallel made on two lines: 8 freedoms of four points, less the parallel one: 7, however it was solved', () => {
    const doc = start(
      [point('a', 0, 0), point('b', 10, 0), point('c', 0, 5), point('d', 10, 7), seg('L', 'a', 'b'), seg('M', 'c', 'd')],
      [{ id: 'p', type: 'parallel', a: 'L', b: 'M' }],
    );
    const s = solve(doc);
    expect(s.dof).toBe(7);
    expect(s.redundant).toEqual([]);
  });
});
