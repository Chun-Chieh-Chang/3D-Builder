/**
 * 4b-2 (docs/phase4b-plan.md): the split line feature (C8.1). A rectangle drawn on a plane beside a cone frustum is projected onto its side; the region it encloses is a face
 * of its own, named after the sketch, whose area is an integral worked out by hand; the names follow edits of the sketch; and a region can be picked for an offset surface.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, SCHEMA_VERSION, type Feature, type PartDoc, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const rebuild = (doc: PartDoc): RebuildResult => {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  return regen.rebuild(doc);
};
const on = (id: string): Ref => ({ kind: 'datum', name: id });
/** A plane `distance` from `base` along its normal, or against it (`reverse`). */
const planeAt = (id: string, base: Ref, distance: number, reverse = false): Feature => ({ id, type: 'refPlane', name: id, suppressed: false, def: { mode: 'offset', plane: base, distance: String(distance), ...(reverse ? { reverse: true } : {}) } }) as Feature;
const status = (r: RebuildResult, id: string) => r.features.find((f) => f.id === id)!;

/** A cone frustum Ø50 to Ø30 over 30, standing on the front plane and growing to −z (so a sketch on the right plane, x = 40, whose x runs along −z, sees it at positive x). */
const cone = (): Feature[] => [
  sketch('s0', front, circle('c0', 0, 0, 25)),
  planeAt('pl1', front, 30, true),
  sketch('s1', on('pl1'), circle('c1', 0, 0, 15)),
  { id: 'lf1', type: 'loft', name: 'lf1', suppressed: false, sections: ['s0', 's1'], op: 'boss' } as Feature,
];
const coneSide = (r: RebuildResult) => r.body!.names.faces[r.body!.topology.faces.findIndex((f) => f.surface === 'cone')]!;
/** The sketch of the outline: a rectangle `h` high from y = 2 (not 0: that is where the cone's seam runs), its x from 5 to 25 (that is z from −5 to −25), on the plane x = 40. */
const outline = (h = 10, extra: Feature[] = []): Feature[] => [planeAt('rpl', on('plane:right'), 40), sketch('s2', on('rpl'), rectangle('r', 5, 2, 20, h)), ...extra];
const split = (face: Ref, extra: Partial<Feature> = {}): Feature => ({ id: 'sp1', type: 'splitLine', name: 'sp1', suppressed: false, sketch: 's2', face, reverse: true, ...extra }) as Feature;
/** The model with the split line made on the side of the cone. */
const model = (h = 10, extra: Partial<Feature> = {}): PartDoc => {
  const base = rebuild(build(...cone()));
  return build(...cone(), ...outline(h), split({ kind: 'face', name: coneSide(base) }, extra));
};

// by hand: the region is ∫ √(1 + r′²) · r · (asin((2 + h) / r) − asin(2 / r)) dz over z from 5 to 25 (the angle round the axis from y = 2 up to y = 2 + h), with r = 25 − z/3
const turn = (h: number, z: number) => Math.asin((2 + h) / (25 - z / 3)) - Math.asin(2 / (25 - z / 3));
const slope = Math.sqrt(1 + 1 / 9);
const integral = (f: (z: number) => number) => {
  let sum = 0;
  for (let k = 0; k < 4000; k++) sum += f(5 + ((k + 0.5) * 20) / 4000) * (20 / 4000);
  return sum;
};
const regionArea = (h: number) => integral((z) => slope * (25 - z / 3) * turn(h, z));
// the offset of that patch by d (along the normal, outward): a cone with radius r + d·cosφ at the same z, cosφ = 3/√10, over the same angles
const offsetArea = (h: number, d: number) => integral((z) => slope * (25 - z / 3 + (d * 3) / Math.sqrt(10)) * turn(h, z));

describe('the split line feature (C8.1)', () => {
  it('cuts the side of the cone along the rectangle: a face of its own whose area is the integral, and the rest of the side keeps its name', () => {
    const base = rebuild(build(...cone()));
    const side = coneSide(base);
    const r = rebuild(model());
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    const names = r.body!.names.faces;
    expect(names).toHaveLength(4);
    const region = r.body!.topology.faces[names.indexOf('sp1:side:s2.rl0')]!;
    expect(region).toBeDefined();
    expect(region.area).toBeCloseTo(regionArea(10), 2);
    // the rest of the side is the whole side less the region, under the name the side had
    const rest = r.body!.topology.faces[names.indexOf(side)]!;
    expect(rest.area).toBeCloseTo(Math.PI * (25 + 15) * Math.hypot(30, 10) - regionArea(10), 2);
  });

  it('the region follows the sketch: the rectangle made 12 high, the area is the new integral and the names are the same', () => {
    let doc = model();
    const before = rebuild(doc).body!.names.faces.slice().sort();
    doc = applyCommand(doc, { type: 'setDimension', featureId: 's2', constraintId: 'rd', value: '12' });
    const r = rebuild(doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(r.body!.names.faces.slice().sort()).toEqual(before);
    expect(r.body!.topology.faces[r.body!.names.faces.indexOf('sp1:side:s2.rl0')]!.area).toBeCloseTo(regionArea(12), 2);
  });

  it('the region can be picked: an offset surface of it by 3 is one face, a cone patch of the area worked out by hand, and it follows the sketch', () => {
    const offset = (): Feature => ({ id: 'os1', type: 'offsetSurface', name: 'os1', suppressed: false, faces: [{ kind: 'face', name: 'sp1:side:s2.rl0' }], distance: '3' }) as Feature;
    let doc = applyCommand(model(), { type: 'insertFeature', feature: offset(), index: 7 } as never);
    let r = rebuild(doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    const surface = r.bodies.find((b) => b.id === 'os1')!;
    expect(surface.surface).toBe(true);
    const faces = kernel.topology(surface.shape).faces;
    expect(faces).toHaveLength(1);
    expect(faces[0]!.area).toBeCloseTo(offsetArea(10, 3), 1);
    doc = applyCommand(doc, { type: 'setDimension', featureId: 's2', constraintId: 'rd', value: '12' });
    r = rebuild(doc);
    expect(kernel.topology(r.bodies.find((b) => b.id === 'os1')!.shape).faces[0]!.area).toBeCloseTo(offsetArea(12, 3), 1);
  });

  it('through all: the line of sight crosses the cone twice and both crossings are cut: two regions with names of their own', () => {
    const r = rebuild(model(10, { throughAll: true }));
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    const names = r.body!.names.faces.filter((n) => n.startsWith('sp1:side:s2.rl0'));
    expect(names.sort()).toEqual(['sp1:side:s2.rl0#1', 'sp1:side:s2.rl0#2']);
    expect(r.body!.names.faces).toHaveLength(5);
  });

  it('says why when it cannot: projected away from the cone, a face that is gone, a sketch that does not close, a sketch that is not there', () => {
    expect(status(rebuild(model(10, { reverse: false })), 'sp1')).toMatchObject({ status: 'error', message: expect.stringContaining('投影不到') });

    const gone = rebuild(build(...cone(), ...outline(), split({ kind: 'face', name: 'lf1:nowhere' })));
    expect(status(gone, 'sp1')).toMatchObject({ status: 'error', message: expect.stringContaining('不見') });

    const base = rebuild(build(...cone()));
    const open = build(
      ...cone(),
      planeAt('rpl', on('plane:right'), 40),
      { id: 's2', type: 'sketch', name: 's2', suppressed: false, plane: on('rpl'), entities: [{ id: 'a', type: 'point', x: 5, y: 0 }, { id: 'b', type: 'point', x: 25, y: 0 }, { id: 'l', type: 'line', p1: 'a', p2: 'b' }], constraints: [] } as Feature,
      split({ kind: 'face', name: coneSide(base) }),
    );
    expect(status(rebuild(open), 'sp1').status).toBe('error');

    expect(() => applyCommand(build(...cone()), { type: 'insertFeature', feature: split({ kind: 'face', name: coneSide(base) }, { sketch: 'nowhere' }), index: 4 } as never)).toThrow();
  });

  it('the command changes it: the direction and the face; a part that holds one is of this schema', () => {
    let doc = model(10, { reverse: false });
    doc = applyCommand(doc, { type: 'setSplitLine', featureId: 'sp1', sketch: 's2', face: (doc.features.find((f) => f.id === 'sp1') as { face: Ref }).face, reverse: true });
    expect(status(rebuild(doc), 'sp1').status).toBe('ok');
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(() => applyCommand(doc, { type: 'setSplitLine', featureId: 'sp1', sketch: 's2', face: { kind: 'edge', name: 'x' } })).toThrow();
  });
});
