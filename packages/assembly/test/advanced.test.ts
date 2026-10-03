/**
 * Advanced mates (C15.9, Phase 4a-2): width, symmetric, and limits on distance and angle, each against a configuration whose answer is worked out by hand.
 */
import { describe, expect, it } from 'vitest';
import { axisAngle, IDENTITY_ROTATION, transformPoint, type Pose, type Vec3 } from '@3db/model';
import { solve, type GoalTerm, type MateGeometry, type MateSpec, type MateType, type SolverBody } from '../src';

const at = (position: Vec3, rotation = IDENTITY_ROTATION): Pose => ({ position, rotation: [...rotation] });
const tilted = (position: Vec3) => at(position, axisAngle([0.6, 0.8, 0], 0.35));
const base: SolverBody = { id: 'base', fixed: true, pose: at([0, 0, 0]) };
const floating = (id: string, pose: Pose, size = 20, pivot: Vec3 = [10, 10, 10]): SolverBody => ({ id, fixed: false, pose, size, pivot });

const plane = (origin: Vec3, normal: Vec3): MateGeometry => ({ kind: 'plane', origin, normal });
const point = (p: Vec3): MateGeometry => ({ kind: 'point', point: p });
const cylinder = (origin: Vec3, axis: Vec3, radius: number, convex = true): MateGeometry => ({ kind: 'cylinder', origin, axis, radius, convex });

let ids = 0;
const mate = (type: MateType, a: [string | null, MateGeometry], b: [string | null, MateGeometry], extra: Partial<MateSpec> = {}): MateSpec => ({
  id: `m${++ids}`,
  type,
  a: { body: a[0], geom: a[1] },
  b: { body: b[0], geom: b[1] },
  ...extra,
});
const end = (body: string | null, geom: MateGeometry) => ({ body, geom });

const where = (s: ReturnType<typeof solve>, id: string, p: Vec3) => transformPoint(s.poses.get(id)!, p);
const turned = (s: ReturnType<typeof solve>, id: string, d: Vec3): Vec3 => {
  const o = where(s, id, [0, 0, 0]);
  const e = where(s, id, d);
  return [e[0] - o[0], e[1] - o[1], e[2] - o[2]];
};
const close = (a: readonly number[], b: readonly number[], digits = 7) => a.forEach((v, i) => expect(v, `component ${i}: ${a} vs ${b}`).toBeCloseTo(b[i]!, digits));
const allOk = (s: ReturnType<typeof solve>) => expect([...s.mates.values()].filter((m) => m.status !== 'ok')).toEqual([]);
const deg = (d: number) => (d * Math.PI) / 180;

describe('symmetric (相互對稱)', () => {
  // The symmetry plane is x = 0 of the base. A face of the base at x = 30 facing +x has its mirror image at x = −30 facing −x.
  const SYMMETRY = plane([0, 0, 0], [1, 0, 0]);

  it('two planes: the floating face lies at x = −30 and faces −x, three freedoms left', () => {
    const s = solve([base, floating('b', tilted([-20, 5, 3]))], [{ ...mate('symmetric', ['base', plane([30, 0, 0], [1, 0, 0])], ['b', plane([0, 0, 0], [-1, 0, 0])]), more: [end('base', SYMMETRY)] }]);
    allOk(s);
    expect(where(s, 'b', [0, 0, 0])[0]).toBeCloseTo(-30, 7);
    close(turned(s, 'b', [-1, 0, 0]), [-1, 0, 0]);
    expect(s.bodies.get('b')).toEqual({ status: 'under', dof: 3 });
  });

  it('the symmetry plane is placed with its own component: a plane at x = 5 puts the mirror image at x = 2 × 5 − 30 = −20', () => {
    const frame: SolverBody = { id: 'frame', fixed: true, pose: at([5, 0, 0]) };
    const s = solve([base, frame, floating('b', tilted([-10, 4, 1]))], [{ ...mate('symmetric', ['base', plane([30, 0, 0], [1, 0, 0])], ['b', plane([0, 0, 0], [-1, 0, 0])]), more: [end('frame', SYMMETRY)] }]);
    allOk(s);
    expect(where(s, 'b', [0, 0, 0])[0]).toBeCloseTo(-20, 7);
  });

  it('two points: the floating point is where the reflection of the first is, all three freedoms of the point taken', () => {
    const s = solve([base, floating('b', tilted([-12, 3, 9]))], [{ ...mate('symmetric', ['base', point([30, 10, 5])], ['b', point([1, 2, 3])]), more: [end('base', SYMMETRY)] }]);
    allOk(s);
    close(where(s, 'b', [1, 2, 3]), [-30, 10, 5]);
    expect(s.bodies.get('b')!.dof).toBe(3);
  });

  it('two axes: a cylinder along y at x = 30 and its mirror image along y at x = −30', () => {
    const s = solve(
      [base, floating('b', tilted([-25, 4, 6]))],
      [{ ...mate('symmetric', ['base', cylinder([30, 0, 7], [0, 1, 0], 4)], ['b', cylinder([0, 0, 0], [0, 1, 0], 4)]), more: [end('base', SYMMETRY)] }],
    );
    allOk(s);
    const o = where(s, 'b', [0, 0, 0]);
    expect(o[0]).toBeCloseTo(-30, 6);
    expect(o[2]).toBeCloseTo(7, 6);
    expect(Math.abs(turned(s, 'b', [0, 1, 0])[1])).toBeCloseTo(1, 7);
    expect(s.bodies.get('b')!.dof).toBe(2); // slides along the axis and turns about it
  });

  it('says what it cannot do: a plane and a point, a symmetry plane that is not a plane', () => {
    const noPair = solve([base, floating('b', at([0, 0, 0]))], [{ ...mate('symmetric', ['base', plane([30, 0, 0], [1, 0, 0])], ['b', point([0, 0, 0])]), more: [end('base', SYMMETRY)] }]);
    expect([...noPair.mates.values()][0]!.status).toBe('unsupported');
    const noPlane = solve([base, floating('b', at([0, 0, 0]))], [{ ...mate('symmetric', ['base', point([30, 0, 0])], ['b', point([0, 0, 0])]), more: [end('base', point([0, 0, 0]))] }]);
    expect([...noPlane.mates.values()][0]!.status).toBe('unsupported');
  });
});

describe('width (寬度)', () => {
  // A slot between the faces x = −10 and x = +30 (its middle is x = 10); a tab 8 thick, its faces at its own x = 0 and x = 8.
  const slot = { a1: plane([-10, 0, 0], [1, 0, 0]), a2: plane([30, 0, 0], [-1, 0, 0]) };
  const tab = { b1: plane([0, 0, 0], [-1, 0, 0]), b2: plane([8, 0, 0], [1, 0, 0]) };
  const widthMate = () => ({ ...mate('width', ['base', slot.a1], ['tab', tab.b1]), more: [end('base', slot.a2), end('tab', tab.b2)] });

  it('centres the tab: the middle of its faces is x = 10, its faces parallel to the slot\'s; three freedoms left', () => {
    const s = solve([base, floating('tab', tilted([2, 6, -3]))], [widthMate()]);
    allOk(s);
    const middle = (where(s, 'tab', [0, 0, 0])[0] + where(s, 'tab', [8, 0, 0])[0]) / 2;
    expect(middle).toBeCloseTo(10, 7);
    expect(Math.abs(turned(s, 'tab', [1, 0, 0])[0])).toBeCloseTo(1, 7);
    expect(s.bodies.get('tab')).toEqual({ status: 'under', dof: 3 });
  });

  it('follows a slot that moves: the slot on a component put 6 mm along x puts the tab 6 mm along', () => {
    const frame = floating('frame', at([6, 0, 0]));
    const s = solve([{ ...frame, fixed: true }, floating('tab', tilted([2, 6, -3]))], [{ ...mate('width', ['frame', slot.a1], ['tab', tab.b1]), more: [end('frame', slot.a2), end('tab', tab.b2)] }]);
    allOk(s);
    expect((where(s, 'tab', [0, 0, 0])[0] + where(s, 'tab', [8, 0, 0])[0]) / 2).toBeCloseTo(16, 7);
  });

  it('keeps the tab where it is along the faces: only the centring, the parallel faces and the turn about the normal are asked', () => {
    const start = at([2, 6, -3]);
    const s = solve([base, floating('tab', start)], [widthMate()]);
    allOk(s);
    const p = where(s, 'tab', [0, 0, 0]);
    expect(p[1]).toBeCloseTo(6, 7);
    expect(p[2]).toBeCloseTo(-3, 7);
  });

  it('wants planes, four of them', () => {
    const s = solve([base, floating('tab', at([0, 0, 0]))], [{ ...mate('width', ['base', slot.a1], ['tab', tab.b1]), more: [end('base', slot.a2), end('tab', point([8, 0, 0]))] }]);
    expect([...s.mates.values()][0]!.status).toBe('unsupported');
  });
});

describe('limits (限制)', () => {
  // The base's top is z = 0; a block above it with its underside face; the distance between them is its height.
  const TOP = plane([0, 0, 0], [0, 0, 1]);
  const BOTTOM = plane([10, 10, 0], [0, 0, -1]);
  const heightOf = (s: ReturnType<typeof solve>) => where(s, 'block', [10, 10, 0])[2];
  const limited = (value: number, min?: number, max?: number) => mate('distance', ['base', TOP], ['block', BOTTOM], { align: 'antiAligned', value, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
  const run = (z: number, m: MateSpec) => solve([base, floating('block', at([0, 0, z]), 20, [10, 10, 10])], [m]);

  it('a distance of 5 to 15: inside the range nothing is held (a height of 8 stays), outside it pulls back to the nearer limit', () => {
    const inside = run(8, limited(10, 5, 15));
    allOk(inside);
    expect(heightOf(inside)).toBeCloseTo(8, 9);
    expect(inside.bodies.get('block')!.dof).toBe(4); // the height is free inside the range
    const above = run(20, limited(10, 5, 15));
    allOk(above);
    expect(heightOf(above)).toBeCloseTo(15, 7);
    const below = run(1, limited(10, 5, 15));
    allOk(below);
    expect(heightOf(below)).toBeCloseTo(5, 7);
  });

  it('on a limit the height is held from one side: three freedoms and a half, counted as the freedoms of the active equations', () => {
    expect(run(20, limited(10, 5, 15)).bodies.get('block')!.dof).toBe(3);
  });

  it('with only a greatest, the block may go down to touching and not through; with only a least, it may go up', () => {
    expect(heightOf(run(30, limited(10, undefined, 12)))).toBeCloseTo(12, 7);
    expect(heightOf(run(4, limited(10, undefined, 12)))).toBeCloseTo(4, 9);
    expect(heightOf(run(2, limited(10, 6)))).toBeCloseTo(6, 7);
    expect(heightOf(run(40, limited(10, 6)))).toBeCloseTo(40, 9);
  });

  it('without limits the distance is the value, as before', () => {
    expect(heightOf(run(30, limited(10)))).toBeCloseTo(10, 7);
  });

  it('dragged against a limit, the block stops at it', () => {
    const grab: Vec3 = [10, 10, 0];
    const terms: GoalTerm[] = [{ kind: 'pointAt', point: grab, target: [10, 10, 30] }, { kind: 'rotation', rotation: [...IDENTITY_ROTATION] }];
    const s = solve([base, floating('block', at([0, 0, 8]), 20, [10, 10, 10])], [limited(10, 5, 15)], { goal: { body: 'block', terms } });
    allOk(s);
    expect(heightOf(s)).toBeCloseTo(15, 6);
  });

  it('an angle of 45° to 135° between the faces: 100° stays; 30° and 170° come back into the range (the equation is flat inside it, so the solve stops at the first angle that is in)', () => {
    // the lid's face normal is its own z; turned about x by `a` it makes the angle `a` with the base's +z
    const lid = (a: number) => solve([base, floating('lid', at([0, 0, 0], axisAngle([1, 0, 0], deg(a))), 20, [0, 0, 0])], [mate('angle', ['base', plane([0, 0, 0], [0, 0, 1])], ['lid', plane([0, 0, 0], [0, 0, 1])], { value: deg(90), min: deg(45), max: deg(135) })]);
    const angleOf = (s: ReturnType<typeof solve>) => (Math.acos(Math.max(-1, Math.min(1, turned(s, 'lid', [0, 0, 1])[2]))) * 180) / Math.PI;
    const stays = lid(100);
    allOk(stays);
    expect(angleOf(stays)).toBeCloseTo(100, 7);
    for (const start of [30, 170]) {
      const s = lid(start);
      allOk(s);
      expect(angleOf(s)).toBeGreaterThanOrEqual(45 - 1e-5);
      expect(angleOf(s)).toBeLessThanOrEqual(135 + 1e-5);
    }
    // from just outside, it is just inside: it did not jump across the range
    expect(angleOf(lid(40))).toBeLessThan(60);
    expect(angleOf(lid(140))).toBeGreaterThan(120);
  });
});
