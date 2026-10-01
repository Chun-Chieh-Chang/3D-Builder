/**
 * Phase 3a-7a (C3.2–C3.5): the other reference planes (parallel, perpendicular, midplane, tangent), reference axes, reference points and coordinate
 * systems. Every position is hand-calculated on a 40 × 30 × 10 plate (z from 0 to 10) with a cylinder of radius 5 at (20, 15) on top of it
 * (ADR 0034).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, mapRefs, type AxisDefinition, type CoordSysFeature, type Feature, type PartDoc, type PlaneDefinition, type PointDefinition, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { dependencies, Regenerator, suppressionTargets, type RebuildResult } from '@3db/regen';
import { build, circle, extrude, face, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});

const right: Ref = { kind: 'datum', name: 'plane:right' }; // normal +X
const top: Ref = { kind: 'datum', name: 'plane:top' }; // normal +Y
const datum = (id: string): Ref => ({ kind: 'datum', name: id });
const vertex = (name: string): Ref => ({ kind: 'vertex', name });
/** The corner of the top face at the crossing of the sides `a` and `b` (al0 y = 0, al1 x = 40, al2 y = 30, al3 x = 0). */
const corner = (a: string, b: string) => vertex(`<e1:cap:end|e1:side:s1.${a}|e1:side:s1.${b}>`);
const plane = (id: string, def: PlaneDefinition): Feature => ({ id, type: 'refPlane', name: id, suppressed: false, def });
const axis = (id: string, def: AxisDefinition): Feature => ({ id, type: 'refAxis', name: id, suppressed: false, def });
const pt = (id: string, def: PointDefinition): Feature => ({ id, type: 'refPoint', name: id, suppressed: false, def });
const system = (id: string, v: Pick<CoordSysFeature, 'origin' | 'x' | 'y' | 'flipX' | 'flipY'>): Feature => ({ id, type: 'coordSys', name: id, suppressed: false, ...v });
/** A 40 × 30 × 10 plate with a post of radius 5 and height 10 on its top face. */
const model = (): Feature[] => [
  sketch('s1', front, rectangle('a', 0, 0, 40, 30)),
  extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
  sketch('s2', face('e1:cap:end'), circle('k', 20, 15, 5)),
  extrude('e2', 's2', 'boss', { type: 'blind', depth: '10' }),
];
const rebuild = (...features: Feature[]) => regen.rebuild(build(...model(), ...features));
const last = (r: RebuildResult) => r.features.at(-1)!;
const near = (got: number[], want: number[], digits = 9) => want.forEach((w, i) => expect(got[i]!).toBeCloseTo(w, digits));
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
/** Is `p` on the plane? */
const onPlane = (r: RebuildResult, id: string, p: number[]) => {
  const f = r.frames.get(id)!;
  return dot([p[0]! - f.origin[0], p[1]! - f.origin[1], p[2]! - f.origin[2]], f.normal);
};
const post = { kind: 'face', name: 'e2:side:s2.k' } as const satisfies Ref;
const vertical: Ref = { kind: 'edge', name: '{e1:side:s1.al0|e1:side:s1.al1}' }; // the edge at x = 40, y = 0, along z

describe('the other reference planes (C3.2)', () => {
  it('parallel: through the corner (40, 30, 10) parallel to the top plane is the plane y = 30, normal +Y', () => {
    const r = rebuild(plane('p1', { mode: 'parallel', plane: top, point: corner('al1', 'al2') }));
    expect(last(r)).toMatchObject({ id: 'p1', status: 'ok' });
    near(r.frames.get('p1')!.normal, [0, 1, 0]);
    expect(onPlane(r, 'p1', [0, 30, 0])).toBeCloseTo(0, 9);
    expect(onPlane(r, 'p1', [0, 0, 0])).toBeCloseTo(-30, 9);
  });

  it('parallel, reversed: the same plane facing −Y', () => {
    const r = rebuild(plane('p1', { mode: 'parallel', plane: top, point: corner('al1', 'al2'), reverse: true }));
    near(r.frames.get('p1')!.normal, [0, -1, 0]);
    expect(onPlane(r, 'p1', [7, 30, 3])).toBeCloseTo(0, 9);
  });

  it('perpendicular: through (40, 0, 10) square to the edge along z is the plane z = 10', () => {
    const r = rebuild(plane('p1', { mode: 'perpendicular', axis: vertical, point: corner('al0', 'al1') }));
    expect(last(r)).toMatchObject({ status: 'ok' });
    near(r.frames.get('p1')!.normal.map(Math.abs), [0, 0, 1]);
    expect(onPlane(r, 'p1', [3, 4, 10])).toBeCloseTo(0, 9);
  });

  it('midplane: halfway between the bottom and the top of the plate is z = 5', () => {
    const r = rebuild(plane('p1', { mode: 'midplane', plane: face('e1:cap:start'), plane2: face('e1:cap:end') }));
    expect(last(r)).toMatchObject({ status: 'ok' });
    near(r.frames.get('p1')!.normal.map(Math.abs), [0, 0, 1]);
    expect(onPlane(r, 'p1', [1, 2, 5])).toBeCloseTo(0, 9);
  });

  it('midplane between the front plane and an offset plane of 25 is z = 12.5', () => {
    const r = rebuild(plane('p1', { mode: 'offset', plane: front, distance: '25' }), plane('p2', { mode: 'midplane', plane: front, plane2: datum('p1') }));
    expect(last(r)).toMatchObject({ id: 'p2', status: 'ok' });
    expect(onPlane(r, 'p2', [0, 0, 12.5])).toBeCloseTo(0, 9);
  });

  it('midplane: planes that are not parallel, or are the same, say so', () => {
    const slanted = rebuild(plane('p1', { mode: 'midplane', plane: front, plane2: top }));
    expect(last(slanted)).toMatchObject({ status: 'error', message: expect.stringContaining('平行') });
    const same = rebuild(plane('p1', { mode: 'midplane', plane: front, plane2: front }));
    expect(last(same)).toMatchObject({ status: 'error', message: expect.stringContaining('重合') });
  });

  it('tangent: to the post, parallel to the right plane, is x = 25; reversed, x = 15 facing −X', () => {
    const a = rebuild(plane('p1', { mode: 'tangent', face: post, plane: right }));
    expect(last(a)).toMatchObject({ status: 'ok' });
    near(a.frames.get('p1')!.normal, [1, 0, 0]);
    expect(onPlane(a, 'p1', [25, 3, 3])).toBeCloseTo(0, 9);
    const b = rebuild(plane('p1', { mode: 'tangent', face: post, plane: right, reverse: true }));
    near(b.frames.get('p1')!.normal, [-1, 0, 0]);
    expect(onPlane(b, 'p1', [15, 3, 3])).toBeCloseTo(0, 9);
  });

  it('tangent: a plane that is not parallel to the axis, or a face that is not a cylinder, say so', () => {
    const across = rebuild(plane('p1', { mode: 'tangent', face: post, plane: front }));
    expect(last(across)).toMatchObject({ status: 'error', message: expect.stringContaining('平行') });
    const flat = rebuild(plane('p1', { mode: 'tangent', face: face('e1:cap:end'), plane: right }));
    expect(last(flat)).toMatchObject({ status: 'error', message: expect.stringContaining('圓柱') });
  });
});

describe('reference axes (C3.3)', () => {
  it('an edge: through its middle along the edge', () => {
    const r = rebuild(axis('x1', { mode: 'edge', edge: vertical }));
    expect(last(r)).toMatchObject({ status: 'ok' });
    const a = r.axes.get('x1')!;
    near(a.dir.map(Math.abs), [0, 0, 1]);
    near(a.origin, [40, 0, 5]);
  });

  it('two points: from (0, 0, 10) to (40, 30, 10) along (0.8, 0.6, 0)', () => {
    const r = rebuild(axis('x1', { mode: 'twoPoints', points: [corner('al0', 'al3'), corner('al1', 'al2')] }));
    near(r.axes.get('x1')!.dir, [0.8, 0.6, 0]);
    near(r.axes.get('x1')!.origin, [0, 0, 10]);
  });

  it('two points that are one, or one point only, say so', () => {
    expect(last(rebuild(axis('x1', { mode: 'twoPoints', points: [corner('al0', 'al3'), corner('al0', 'al3')] })))).toMatchObject({ status: 'error', message: expect.stringContaining('重合') });
    expect(last(rebuild(axis('x1', { mode: 'twoPoints', points: [corner('al0', 'al3')] })))).toMatchObject({ status: 'error', message: expect.stringContaining('兩個點') });
  });

  it('a cylinder: the axis of the post, through (20, 15) along z', () => {
    const r = rebuild(axis('x1', { mode: 'cylinder', face: post }));
    expect(last(r)).toMatchObject({ status: 'ok' });
    const a = r.axes.get('x1')!;
    near(a.dir.map(Math.abs), [0, 0, 1]);
    expect(a.origin[0]).toBeCloseTo(20, 9);
    expect(a.origin[1]).toBeCloseTo(15, 9);
    expect(last(rebuild(axis('x1', { mode: 'cylinder', face: face('e1:cap:end') })))).toMatchObject({ status: 'error', message: expect.stringContaining('圓柱') });
  });

  it('two planes: the right plane and the front plane meet in the y axis; the right plane and a plane at z = 25 meet at (0, 0, 25)', () => {
    const a = rebuild(axis('x1', { mode: 'planes', plane: front, plane2: right }));
    near(a.axes.get('x1')!.dir, [0, 1, 0]);
    near(a.axes.get('x1')!.origin, [0, 0, 0]);
    const b = rebuild(plane('p1', { mode: 'offset', plane: front, distance: '25' }), axis('x1', { mode: 'planes', plane: datum('p1'), plane2: right }));
    near(b.axes.get('x1')!.dir, [0, 1, 0]);
    near(b.axes.get('x1')!.origin, [0, 0, 25]);
    // two planes that are not at right angles: the axis lies in both
    const c = rebuild(plane('p1', { mode: 'angle', plane: face('e1:cap:end'), axis: { kind: 'edge', name: '{e1:cap:end|e1:side:s1.al1}' }, angle: '30' }), axis('x1', { mode: 'planes', plane: datum('p1'), plane2: front }));
    const x = c.axes.get('x1')!;
    expect(onPlane(c, 'p1', x.origin)).toBeCloseTo(0, 9);
    expect(x.origin[2]).toBeCloseTo(0, 9);
    expect(dot(x.dir, c.frames.get('p1')!.normal)).toBeCloseTo(0, 9);
  });

  it('two parallel planes have no line to share', () => {
    expect(last(rebuild(axis('x1', { mode: 'planes', plane: front, plane2: face('e1:cap:end') })))).toMatchObject({ status: 'error', message: expect.stringContaining('平行') });
  });

  it('a plane through a reference axis at 90° to the right plane, and a plane square to the axis through a point', () => {
    const r = rebuild(
      axis('x1', { mode: 'cylinder', face: post }),
      plane('p1', { mode: 'angle', plane: right, axis: datum('x1'), angle: '90' }),
      plane('p2', { mode: 'perpendicular', axis: datum('x1'), point: corner('al1', 'al2') }),
    );
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    // a plane turned 90° about the post's axis from the right plane contains the axis and has a normal across it
    expect(onPlane(r, 'p1', [20, 15, 99])).toBeCloseTo(0, 9);
    expect(Math.abs(dot(r.frames.get('p1')!.normal, [0, 0, 1]))).toBeCloseTo(0, 9);
    expect(onPlane(r, 'p2', [1, 1, 10])).toBeCloseTo(0, 9);
  });
});

describe('reference points (C3.5)', () => {
  it('by coordinates, from expressions', () => {
    const r = rebuild(pt('q1', { mode: 'coords', x: '10', y: '5mm*2', z: '2.5' }));
    near(r.points.get('q1')!, [10, 10, 2.5]);
  });

  it('the centre of a circle edge, of a straight edge, of a face', () => {
    const rim = rebuild(pt('q1', { mode: 'center', element: { kind: 'edge', name: '{e2:cap:end|e2:side:s2.k}' } }));
    expect(last(rim)).toMatchObject({ status: 'ok' });
    near(rim.points.get('q1')!, [20, 15, 20]);
    const mid = rebuild(pt('q1', { mode: 'center', element: vertical }));
    near(mid.points.get('q1')!, [40, 0, 5]);
    const top = rebuild(pt('q1', { mode: 'center', element: face('e2:cap:end') }));
    near(top.points.get('q1')!, [20, 15, 20]);
  });

  it('where the post axis meets a plane at z = 25', () => {
    const r = rebuild(axis('x1', { mode: 'cylinder', face: post }), plane('p1', { mode: 'offset', plane: front, distance: '25' }), pt('q1', { mode: 'axisPlane', axis: datum('x1'), plane: datum('p1') }));
    near(r.points.get('q1')!, [20, 15, 25]);
  });

  it('an axis parallel to the plane has no point to give', () => {
    const r = rebuild(axis('x1', { mode: 'edge', edge: vertical }), pt('q1', { mode: 'axisPlane', axis: datum('x1'), plane: right }));
    expect(last(r)).toMatchObject({ status: 'error', message: expect.stringContaining('平行') });
  });

  it('a plane through three reference points and an axis through two of them', () => {
    const r = rebuild(
      pt('q1', { mode: 'coords', x: '0', y: '0', z: '3' }),
      pt('q2', { mode: 'coords', x: '10', y: '0', z: '3' }),
      pt('q3', { mode: 'coords', x: '0', y: '10', z: '3' }),
      plane('p1', { mode: 'threePoint', points: [datum('q1'), datum('q2'), datum('q3')] }),
      axis('x1', { mode: 'twoPoints', points: [datum('q1'), datum('q2')] }),
    );
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(onPlane(r, 'p1', [5, 5, 3])).toBeCloseTo(0, 9);
    near(r.frames.get('p1')!.normal, [0, 0, 1]);
    near(r.axes.get('x1')!.dir, [1, 0, 0]);
  });
});

describe('coordinate systems (C3.4)', () => {
  it('X along the post axis, Y towards the right plane normal: right-handed, square, at the post', () => {
    const r = rebuild(axis('x1', { mode: 'cylinder', face: post }), pt('q1', { mode: 'center', element: face('e2:cap:end') }), system('c1', { origin: datum('q1'), x: datum('x1'), y: right }));
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    const c = r.systems.get('c1')!;
    near(c.origin, [20, 15, 20]);
    near(c.x.map(Math.abs), [0, 0, 1]);
    expect(dot(c.x, c.y)).toBeCloseTo(0, 9);
    expect(dot(c.y, [1, 0, 0])).toBeGreaterThan(0.999);
    // z = x × y
    near(c.z, [c.x[1] * c.y[2] - c.x[2] * c.y[1], c.x[2] * c.y[0] - c.x[0] * c.y[2], c.x[0] * c.y[1] - c.x[1] * c.y[0]]);
  });

  it('with no origin it sits at the part origin; flipping X turns X around and Z with it', () => {
    const a = rebuild(system('c1', { x: right, y: top }));
    near(a.systems.get('c1')!.origin, [0, 0, 0]);
    near(a.systems.get('c1')!.x, [1, 0, 0]);
    near(a.systems.get('c1')!.y, [0, 1, 0]);
    near(a.systems.get('c1')!.z, [0, 0, 1]);
    const b = rebuild(system('c1', { x: right, y: top, flipX: true }));
    near(b.systems.get('c1')!.x, [-1, 0, 0]);
    near(b.systems.get('c1')!.y, [0, 1, 0]);
    near(b.systems.get('c1')!.z, [0, 0, -1]);
  });

  it('Y is made square to X when the two directions are not', () => {
    const r = rebuild(
      axis('x1', { mode: 'twoPoints', points: [corner('al0', 'al3'), corner('al1', 'al2')] }), // (0.8, 0.6, 0)
      system('c1', { x: right, y: datum('x1') }),
    );
    const c = r.systems.get('c1')!;
    near(c.x, [1, 0, 0]);
    near(c.y, [0, 1, 0]); // the part of (0.8, 0.6, 0) square to X
    near(c.z, [0, 0, 1]);
  });

  it('two directions that are parallel say so', () => {
    expect(last(rebuild(system('c1', { x: right, y: right })))).toMatchObject({ status: 'error', message: expect.stringContaining('平行') });
  });
});

describe('what depends on what', () => {
  const doc = (): PartDoc =>
    build(
      ...model(),
      axis('x1', { mode: 'cylinder', face: post }),
      pt('q1', { mode: 'center', element: face('e2:cap:end') }),
      plane('p1', { mode: 'perpendicular', axis: datum('x1'), point: datum('q1') }),
      system('c1', { origin: datum('q1'), x: datum('x1'), y: right }),
    );

  it('a datum is a child of whatever it refers to, and a feature that uses it of the datum', () => {
    const d = dependencies(doc());
    expect(d.parents.get('x1')).toEqual(['e2']);
    expect(d.parents.get('q1')).toEqual(['e2']);
    expect(d.parents.get('p1')).toEqual(['x1', 'q1']);
    expect(d.parents.get('c1')).toEqual(['q1', 'x1']);
  });

  it('suppressing the axis suppresses the plane and the system; the point stays', () => {
    expect(suppressionTargets(doc(), 'x1', 'suppress')).toEqual(['x1', 'p1', 'c1']);
  });

  it('a datum can only refer to an earlier datum of the kind it needs', () => {
    expect(() => applyCommand(doc(), { type: 'insertFeature', index: 4, feature: plane('p9', { mode: 'perpendicular', axis: datum('p1'), point: datum('q1') }) })).toThrow('必須在它之前');
    expect(() => applyCommand(doc(), { type: 'insertFeature', index: 4, feature: plane('p9', { mode: 'perpendicular', axis: datum('x1'), point: datum('x1') }) })).toThrow('必須在它之前');
    expect(() => applyCommand(doc(), { type: 'insertFeature', index: 4, feature: plane('p9', { mode: 'perpendicular', axis: datum('c1'), point: datum('q1') }) })).toThrow('必須在它之前');
    expect(() => applyCommand(doc(), { type: 'insertFeature', index: 4, feature: pt('q9', { mode: 'center', element: vertex('v') }) })).toThrow();
  });

  it('the commands change a definition and refuse the wrong kind of feature', () => {
    const d = applyCommand(doc(), { type: 'setRefAxis', featureId: 'x1', def: { mode: 'edge', edge: vertical } });
    expect(d.features.find((f) => f.id === 'x1')).toMatchObject({ def: { mode: 'edge' } });
    expect(() => applyCommand(doc(), { type: 'setRefAxis', featureId: 'q1', def: { mode: 'edge', edge: vertical } })).toThrow();
    const e = applyCommand(doc(), { type: 'setCoordSys', featureId: 'c1', value: { x: right, y: top, flipY: true } });
    expect(e.features.find((f) => f.id === 'c1')).toMatchObject({ x: right, y: top, flipY: true });
    expect(e.features.find((f) => f.id === 'c1')).not.toHaveProperty('origin');
    const f = applyCommand(doc(), { type: 'setRefPoint', featureId: 'q1', def: { mode: 'coords', x: '1', y: '2', z: '3' } });
    expect(f.features.find((x) => x.id === 'q1')).toMatchObject({ def: { mode: 'coords', x: '1' } });
  });

  it('a reference repaired in a definition is replaced in every kind of datum', () => {
    const swap = (ref: Ref): Ref => (ref.kind === 'face' ? { ...ref, name: 'swapped' } : ref);
    const x = mapRefs(doc().features.find((f) => f.id === 'x1')!, swap);
    expect(x).toMatchObject({ replaced: 1, feature: { def: { face: { name: 'swapped' } } } });
    const q = mapRefs(doc().features.find((f) => f.id === 'q1')!, swap);
    expect(q.replaced).toBe(1);
    const c = mapRefs(doc().features.find((f) => f.id === 'c1')!, (ref) => (ref.name === 'plane:right' ? top : ref));
    expect(c).toMatchObject({ replaced: 1, feature: { y: top } });
  });

  it('the post moves, and the datums built on it move with it', () => {
    const wide = build(
      sketch('s1', front, rectangle('a', 0, 0, 40, 30)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
      sketch('s2', face('e1:cap:end'), circle('k', 30, 15, 5)),
      extrude('e2', 's2', 'boss', { type: 'blind', depth: '10' }),
      axis('x1', { mode: 'cylinder', face: post }),
      pt('q1', { mode: 'center', element: face('e2:cap:end') }),
    );
    const r = regen.rebuild(wide);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    near(r.axes.get('x1')!.origin.slice(0, 2), [30, 15]);
    near(r.points.get('q1')!, [30, 15, 20]);
  });
});
