/**
 * 4a-5 (docs/phase4a-plan.md): clearance verification and room to take a component out (E2.2). Blocks whose gaps are known by hand: the distance of two
 * components, exactly and where; how far a block can move along a direction before it meets another, to a hundredth of a millimetre.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lerpPose, type InterferenceComponent, type Pose, type Vec3 } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { findClearance, findInterference, Regenerator, sweepClearance } from '@3db/regen';
import { build, extrude, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
const shapes = new Map<string, ShapeId>();
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  // a cube of 10 and a plate of 100 × 100 × 5, each from its corner at the origin
  for (const [key, w, d, h] of [['cube', 10, 10, 10], ['plate', 100, 100, 5]] as const) {
    const regen = new Regenerator(kernel, solver);
    kept.push(regen);
    shapes.set(key, regen.rebuild(build(sketch('s', front, rectangle('a', 0, 0, w, d)), extrude('e', 's', 'boss', { type: 'blind', depth: String(h) }))).body!.shape);
  }
});
afterAll(() => kept.forEach((r) => r.dispose()));

const at = (position: Vec3): Pose => ({ position, rotation: [0, 0, 0, 1] });
const comp = (id: string, part: string, position: Vec3): InterferenceComponent => ({ id, parts: [{ part, mirrored: false, pose: at(position) }] });
const shapeOf = (part: string) => shapes.get(part) ?? null;

describe('clearance verification (E2.2)', () => {
  it('two cubes 5 mm apart: 5, at the faces that face each other; and not found when the least clearance is 4', () => {
    const cs = [comp('a', 'cube', [0, 0, 0]), comp('b', 'cube', [15, 0, 0])];
    const found = findClearance(kernel, cs, shapeOf, 10);
    expect(found.rows).toHaveLength(1);
    const row = found.rows[0]!;
    expect([row.a, row.b]).toEqual(['a', 'b']);
    expect(row.distance).toBeCloseTo(5, 9);
    expect(row.pointA[0]).toBeCloseTo(10, 9);
    expect(row.pointB[0]).toBeCloseTo(15, 9);
    expect(row.interferes).toBe(false);
    expect(findClearance(kernel, cs, shapeOf, 4).rows).toEqual([]);
  });

  it('cubes apart diagonally: √(5² + 5²), between their corners', () => {
    const row = findClearance(kernel, [comp('a', 'cube', [0, 0, 0]), comp('b', 'cube', [15, 15, 0])], shapeOf, 20).rows[0]!;
    expect(row.distance).toBeCloseTo(Math.hypot(5, 5), 9);
    expect([row.pointA[0], row.pointA[1]]).toEqual([expect.closeTo(10, 9), expect.closeTo(10, 9)]);
  });

  it('touching is 0 and not interference; sharing volume is 0 and interference', () => {
    const touching = findClearance(kernel, [comp('a', 'cube', [0, 0, 0]), comp('b', 'cube', [10, 0, 0])], shapeOf, 1).rows[0]!;
    expect([touching.distance, touching.interferes]).toEqual([expect.closeTo(0, 9), false]);
    const overlapping = findClearance(kernel, [comp('a', 'cube', [0, 0, 0]), comp('b', 'cube', [6, 0, 0])], shapeOf, 1).rows[0]!;
    expect([overlapping.distance, overlapping.interferes]).toEqual([expect.closeTo(0, 9), true]);
  });

  it('lists the closest pair first, and with `only` just the pairs of a component', () => {
    const cs = [comp('a', 'cube', [0, 0, 0]), comp('b', 'cube', [13, 0, 0]), comp('c', 'cube', [30, 0, 0])];
    const all = findClearance(kernel, cs, shapeOf, 12).rows;
    expect(all.map((r) => [r.a, r.b, Math.round(r.distance * 1e6) / 1e6])).toEqual([['a', 'b', 3], ['b', 'c', 7]]);
    expect(findClearance(kernel, cs, shapeOf, 12, new Set(['c'])).rows.map((r) => [r.a, r.b])).toEqual([['b', 'c']]);
  });

  it('the parts of one component are not compared with each other', () => {
    const one: InterferenceComponent = { id: 'a', parts: [{ part: 'cube', mirrored: false, pose: at([0, 0, 0]) }, { part: 'cube', mirrored: false, pose: at([12, 0, 0]) }] };
    expect(findClearance(kernel, [one, comp('b', 'cube', [100, 0, 0])], shapeOf, 5).rows).toEqual([]);
  });

  it('does not measure what is further apart than the least clearance (the boxes say so), and says so in the count', () => {
    const found = findClearance(kernel, [comp('a', 'cube', [0, 0, 0]), comp('b', 'cube', [100, 0, 0])], shapeOf, 5);
    expect([found.rows, found.checked]).toEqual([[], 0]);
  });
});

describe('room to take a component out (E2.2)', () => {
  // A cube at the origin and a second cube 20 further along x: x = 30 to 40, the same y and z.
  const row = [comp('mover', 'cube', [0, 0, 0]), comp('wall', 'cube', [30, 0, 0])];

  it('moving toward the wall it can go 20 mm: its face (x = 10) to the wall (x = 30)', () => {
    const r = sweepClearance(kernel, row, 'mover', [1, 0, 0], 100, shapeOf);
    expect(r.travel).toBeCloseTo(20, 3);
    expect(r.blocker).toBe('wall');
    expect(r.startsInside).toBe(false);
  });

  it('a direction that is not an axis: along (1, 0.2, 0) the contact is at 20 / cos(atan 0.2) = 20.396', () => {
    const r = sweepClearance(kernel, row, 'mover', [1, 0.2, 0], 100, shapeOf);
    expect(r.travel).toBeCloseTo(20 / (1 / Math.hypot(1, 0.2)), 3);
    expect(r.blocker).toBe('wall');
  });

  it('away from the wall, up, and past it above, the way is free for the whole length', () => {
    for (const d of [[-1, 0, 0], [0, 0, 1], [0, 1, 0], [0, 0, -1]] as Vec3[]) {
      const r = sweepClearance(kernel, row, 'mover', d, 50, shapeOf);
      expect([r.travel, r.blocker]).toEqual([50, null]);
    }
  });

  it('a shorter length than the gap: free', () => {
    expect(sweepClearance(kernel, row, 'mover', [1, 0, 0], 15, shapeOf)).toMatchObject({ travel: 15, blocker: null });
  });

  it('on a plate (touching it) the part slides along it freely, lifts off it, and cannot go down into it', () => {
    const onPlate = [comp('mover', 'cube', [20, 20, 5]), comp('plate', 'plate', [0, 0, 0])];
    expect(sweepClearance(kernel, onPlate, 'mover', [1, 0, 0], 50, shapeOf)).toMatchObject({ travel: 50, blocker: null, startsInside: false });
    expect(sweepClearance(kernel, onPlate, 'mover', [0, 0, 1], 50, shapeOf)).toMatchObject({ travel: 50, blocker: null });
    const down = sweepClearance(kernel, onPlate, 'mover', [0, 0, -1], 50, shapeOf);
    expect(down.travel).toBeLessThan(0.01);
    expect(down.blocker).toBe('plate');
  });

  it('a part that is already inside another cannot move to anywhere that keeps it inside, and says it starts inside', () => {
    const r = sweepClearance(kernel, [comp('mover', 'cube', [0, 0, 0]), comp('wall', 'cube', [5, 0, 0])], 'mover', [1, 0, 0], 50, shapeOf);
    expect(r).toMatchObject({ travel: 0, startsInside: true, blocker: 'wall' });
  });

  it('through a gap: a cube of 10 slides past a block it touches and one 0.5 mm clear of it; with the second block 0.5 mm into its way it stops at 20', () => {
    // the first block fills y = −10…0 (it touches the cube's side all the way), the second starts at y = 10 + gap
    const corridor = (gap: number) => [comp('mover', 'cube', [0, 0, 0]), comp('w1', 'cube', [30, -10, 0]), comp('w2', 'cube', [30, 10 + gap, 0])];
    expect(sweepClearance(kernel, corridor(0.5), 'mover', [1, 0, 0], 60, shapeOf)).toMatchObject({ travel: 60, blocker: null });
    const blocked = sweepClearance(kernel, corridor(-0.5), 'mover', [1, 0, 0], 60, shapeOf);
    expect(blocked.travel).toBeCloseTo(20, 3);
    expect(blocked.blocker).toBe('w2');
  });
});

describe('what a drag asks (A3.6): the poses in between, and the collisions of what moves', () => {
  it('lerpPose goes straight in position and by the short way in rotation', () => {
    const a: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    const b: Pose = { position: [10, 20, 30], rotation: [0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)] };
    expect(lerpPose(a, b, 0)).toEqual(a);
    expect(lerpPose(a, b, 1).position).toEqual([10, 20, 30]);
    const half = lerpPose(a, b, 0.5);
    expect(half.position).toEqual([5, 10, 15]);
    expect(Math.hypot(...half.rotation)).toBeCloseTo(1, 12);
    // from the identity to a quarter turn about z, half way is an eighth of a turn (close, by normalized interpolation)
    expect(2 * Math.atan2(half.rotation[2], half.rotation[3])).toBeCloseTo(Math.PI / 4, 1);
    const opposite = lerpPose(a, { ...b, rotation: [0, 0, -b.rotation[2], -b.rotation[3]] }, 0.5);
    expect(opposite.rotation[3]).toBeGreaterThan(0.9); // the short way, not through the other side
  });

  it('only the pairs with the component that moves are asked about', () => {
    const cs = [comp('a', 'cube', [0, 0, 0]), comp('b', 'cube', [5, 0, 0]), comp('c', 'cube', [100, 0, 0]), comp('d', 'cube', [105, 0, 0])];
    const all = findInterference(kernel, cs, shapeOf);
    expect(all.overlaps.map((o) => [o.a, o.b])).toEqual([['a', 'b'], ['c', 'd']]);
    all.overlaps.forEach((o) => kernel.release(o.shape));
    const some = findInterference(kernel, cs, shapeOf, undefined, new Set(['d']));
    expect(some.overlaps.map((o) => [o.a, o.b])).toEqual([['c', 'd']]);
    some.overlaps.forEach((o) => kernel.release(o.shape));
  });
});
