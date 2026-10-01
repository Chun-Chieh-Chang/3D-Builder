import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, resolveSketch, type Command, type PartDoc, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import { findProfiles, PlaneGcsSolver, type SolvedSketch } from '../src/index';
import { checkSketch, repairSketch } from '../src/check';

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
const solve = (doc: PartDoc): SolvedSketch => solver.solve(resolveSketch(sketchOf(doc), doc));
const point = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const line = (id: string, p1: string, p2: string): SketchEntity => ({ id, type: 'line', p1, p2 });

describe('check sketch (C1.35)', () => {
  it('finds nothing wrong with a closed square', () => {
    const doc = start([point('a', 0, 0), point('b', 10, 0), point('c', 10, 10), point('d', 0, 10), line('l1', 'a', 'b'), line('l2', 'b', 'c'), line('l3', 'c', 'd'), line('l4', 'd', 'a')]);
    expect(checkSketch(sketchOf(doc), solve(doc).geometry, 0.1)).toEqual([]);
  });

  it('a gap within the tolerance is a gap (a wider one is two open ends), and repairing it closes the profile', () => {
    const doc = start([point('a', 0, 0), point('b', 10, 0), point('c', 10, 10), point('d', 0, 10), point('e', 0, 0.05), line('l1', 'a', 'b'), line('l2', 'b', 'c'), line('l3', 'c', 'd'), line('l4', 'e', 'd')]);
    const issues = checkSketch(sketchOf(doc), solve(doc).geometry, 0.1);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'gap', size: expect.closeTo(0.05, 6) });
    expect(checkSketch(sketchOf(doc), solve(doc).geometry, 0.01).map((i) => i.kind)).toEqual(['openEnd', 'openEnd']);
    expect(findProfiles(sketchOf(doc), solve(doc)).regions).toHaveLength(0);
    const fix = repairSketch(sketchOf(doc), solve(doc).geometry, 0.1);
    if ('error' in fix) throw new Error(fix.error);
    expect(fix).toMatchObject({ fixed: 1, skipped: 0 });
    const repaired = applyCommand(doc, { type: 'editSketch', featureId: 's1', ...fix.edit });
    const after = solve(repaired);
    expect(findProfiles(sketchOf(repaired), after).problems).toEqual([]);
    expect(findProfiles(sketchOf(repaired), after).regions).toHaveLength(1);
    expect(checkSketch(sketchOf(repaired), after.geometry, 0.1)).toEqual([]);
  });

  it('finds a branch, a duplicate, a zero-length line and a crossing, each with the entities to show', () => {
    const tee = start([point('o', 0, 0), point('a', 5, 0), point('b', 0, 5), point('c', -5, 0), line('A', 'o', 'a'), line('B', 'o', 'b'), line('C', 'o', 'c')]);
    expect(checkSketch(sketchOf(tee), solve(tee).geometry, 0.1).find((i) => i.kind === 'branch')).toMatchObject({ ids: ['A', 'B', 'C'] });

    const twice = start([point('a', 0, 0), point('b', 5, 0), point('c', 0.0, 0), line('A', 'a', 'b'), line('B', 'b', 'a'), line('Z', 'a', 'c')]);
    const found = checkSketch(sketchOf(twice), solve(twice).geometry, 0.1).map((i) => `${i.kind}:${i.ids.join('+')}`);
    expect(found).toContain('duplicate:A+B');
    expect(found).toContain('zeroLength:Z');

    const cross = start([point('a', -5, 0), point('b', 5, 0), point('c', 0, -5), point('d', 0, 5), line('H', 'a', 'b'), line('V', 'c', 'd')]);
    expect(checkSketch(sketchOf(cross), solve(cross).geometry, 0.1).find((i) => i.kind === 'crossing')).toMatchObject({ ids: ['H', 'V'], at: [expect.closeTo(0, 6), expect.closeTo(0, 6)] });
    // a line that only ends on the other's end is no crossing; one that ends on its middle is
    const ell = start([point('a', 0, 0), point('b', 5, 0), point('c', 0, 5), line('H', 'a', 'b'), line('V', 'a', 'c')]);
    expect(checkSketch(sketchOf(ell), solve(ell).geometry, 0.1).some((i) => i.kind === 'crossing')).toBe(false);
    const tJoint = start([point('a', -5, 0), point('b', 5, 0), point('c', 0, 0.0), point('d', 0, 5), line('H', 'a', 'b'), line('V', 'c', 'd')]);
    expect(checkSketch(sketchOf(tJoint), solve(tJoint).geometry, 0.1).some((i) => i.kind === 'crossing')).toBe(true);
  });

  it('does not look at construction geometry, and a circle crossed by a line is one crossing', () => {
    const doc = start([point('a', -5, 0), point('b', 5, 0), { id: 'H', type: 'line', p1: 'a', p2: 'b', construction: true }, point('c', 0, 0), { id: 'C', type: 'circle', center: 'c', radius: 3 }]);
    expect(checkSketch(sketchOf(doc), solve(doc).geometry, 0.1)).toEqual([]);
    const solid = start([point('a', -5, 0), point('b', 5, 0), line('H', 'a', 'b'), point('c', 0, 0), { id: 'C', type: 'circle', center: 'c', radius: 3 }]);
    expect(checkSketch(sketchOf(solid), solve(solid).geometry, 0.1).filter((i) => i.kind === 'crossing')).toHaveLength(1);
  });
});

describe('repair sketch (C1.35)', () => {
  it('deletes the duplicate and the zero-length line in one step and leaves the rest alone', () => {
    const doc = start([point('a', 0, 0), point('b', 5, 0), point('c', 0, 0), point('d', 5, 5), line('A', 'a', 'b'), line('B', 'b', 'a'), line('Z', 'a', 'c'), line('K', 'b', 'd')]);
    const fix = repairSketch(sketchOf(doc), solve(doc).geometry, 0.1);
    if ('error' in fix) throw new Error(fix.error);
    expect(fix).toMatchObject({ fixed: 2, skipped: 0 });
    const repaired = applyCommand(doc, { type: 'editSketch', featureId: 's1', ...fix.edit });
    expect(sketchOf(repaired).entities.filter((e) => e.type === 'line').map((e) => e.id).sort()).toEqual(['A', 'K']);
  });

  it('leaves a gap alone when a dimension is between its ends, and says so; and says when there is nothing to do', () => {
    const doc = start(
      [point('a', 0, 0), point('b', 10, 0), point('c', 10, 10), point('d', 0, 10), point('e', 0, 0.05), line('l1', 'a', 'b'), line('l2', 'b', 'c'), line('l3', 'c', 'd'), line('l4', 'e', 'd')],
      [{ id: 'k', type: 'distance', a: 'a', b: 'e', value: '0.05' }],
    );
    const fix = repairSketch(sketchOf(doc), solve(doc).geometry, 0.1);
    if ('error' in fix) throw new Error(fix.error);
    expect(fix).toMatchObject({ fixed: 0, skipped: 1 });
    const clean = start([point('a', 0, 0), point('b', 5, 0), line('A', 'a', 'b')]);
    expect(repairSketch(sketchOf(clean), solve(clean).geometry, 0.1)).toMatchObject({ error: expect.stringContaining('沒有可以自動修復') });
  });
});
