/**
 * P-3 (docs/surface-trim-plan.md, ADR 0109): the mutual trim of two surface bodies. A block 40 × 30 × 20 (x 0..40, y 0..30, z 0..20); the surface `os1` is its top offset 8 down, a
 * plane z = 12 of 40 × 30; `os2` is its side at x = 40 offset 15 in, a plane x = 25 of 30 (y) × 20 (z). They cross along the line x = 25, z = 12, 30 long. Worked out by hand:
 *   - os1 falls into x < 25: 25 × 30 = 750 and x > 25: 15 × 30 = 450;
 *   - os2 falls into z < 12: 30 × 12 = 360 and z > 12: 30 × 8 = 240.
 * The pieces of a face are `#1`, `#2` in the order of their centres (x, then y, then z): so `#1` of os1 is the 750 and `#1` of os2 the 360.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, SCHEMA_VERSION, type Feature, type PartDoc, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type Region, type ShapeId } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, extrude, front, rectangle, sketch, statuses } from '../phase1/builders';

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
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const status = (r: RebuildResult, id: string) => r.features.find((f) => f.id === id)!;
const insert = (doc: PartDoc, feature: Feature): PartDoc => applyCommand(doc, { type: 'insertFeature', feature, index: doc.features.length } as never);
const body = (name: string): Ref => ({ kind: 'body', name });
const faceRef = (name: string): Ref => ({ kind: 'face', name });
const facesOf = (r: RebuildResult, id: string) => {
  const b = r.bodies.find((x) => x.id === id)!;
  const names = r.body!.names.faces.slice(b.face0, b.face0 + b.faces);
  const faces = r.body!.topology.faces.slice(b.face0, b.face0 + b.faces);
  return names.map((name, i) => ({ name, area: faces[i]!.area, center: faces[i]!.center })).sort((x, y) => x.name.localeCompare(y.name));
};

const offset = (id: string, face: string, distance: string): Feature => ({ id, type: 'offsetSurface', name: id, suppressed: false, faces: [{ kind: 'face', name: face }], distance }) as Feature;
const NAME1 = 'os1:offset:e1:cap:end';
const NAME2 = 'os2:offset:e1:side:s1.rl1';
const blocks = (distance2 = '-15'): PartDoc => build(sketch('s1', front, rectangle('r', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }), offset('os1', 'e1:cap:end', '-8'), offset('os2', 'e1:side:s1.rl1', distance2));
const trim = (extra: Partial<Feature> = {}): Feature => ({ id: 'mt1', type: 'mutualTrim', name: 'mt1', suppressed: false, a: body('os1'), b: body('os2'), ...extra }) as Feature;

describe('mutual trim (P-3)', () => {
  it('the two planes cross along x = 25, z = 12: os1 is 750 + 450, os2 is 360 + 240, the pieces are named after their faces with #1 and #2, the bodies keep their ids and are still surfaces', () => {
    const before = rebuild(blocks());
    expect(failures(before)).toEqual([]);
    expect(facesOf(before, 'os1').map((f) => [f.name, Math.round(f.area)])).toEqual([[NAME1, 1200]]);
    expect(facesOf(before, 'os2').map((f) => [f.name, Math.round(f.area)])).toEqual([[NAME2, 600]]);
    const r = rebuild(insert(blocks(), trim()));
    expect(failures(r)).toEqual([]);
    expect(r.bodies.map((b) => [b.id, b.surface])).toEqual([['e1', false], ['os1', true], ['os2', true]]);
    const a = facesOf(r, 'os1');
    expect(a.map((f) => f.name)).toEqual([`${NAME1}#1`, `${NAME1}#2`]);
    expect(a[0]!.area).toBeCloseTo(750, 4);
    expect(a[1]!.area).toBeCloseTo(450, 4);
    const b = facesOf(r, 'os2');
    expect(b.map((f) => f.name)).toEqual([`${NAME2}#1`, `${NAME2}#2`]);
    expect(b[0]!.area).toBeCloseTo(360, 4);
    expect(b[1]!.area).toBeCloseTo(240, 4);
    expect(status(r, 'mt1').info).toBe('互相修剪：兩個本體各有 2 片、2 片（去掉了 0 片）');
    const all = r.body!.names.faces;
    expect(new Set(all).size).toBe(all.length);
  });

  it('the pieces taken away are gone and the others keep their names: os1 without its 450 and os2 without its 240 is 750 and 360', () => {
    const r = rebuild(insert(blocks(), trim({ discard: [faceRef(`${NAME1}#2`), faceRef(`${NAME2}#2`)] })));
    expect(failures(r)).toEqual([]);
    expect(facesOf(r, 'os1').map((f) => [f.name, Math.round(f.area)])).toEqual([[`${NAME1}#1`, 750]]);
    expect(facesOf(r, 'os2').map((f) => [f.name, Math.round(f.area)])).toEqual([[`${NAME2}#1`, 360]]);
    expect(status(r, 'mt1').info).toBe('互相修剪：兩個本體各有 1 片、1 片（去掉了 2 片）');
  });

  it('the piece to take away follows the model: the second plane moved to x = 30 makes os1 900 + 300, and the piece with the larger x (300) is the one that goes', () => {
    let doc = insert(blocks(), trim({ discard: [faceRef(`${NAME1}#2`)] }));
    doc = applyCommand(doc, { type: 'setOffsetSurface', featureId: 'os2', faces: [{ kind: 'face', name: 'e1:side:s1.rl1' }], distance: '-10' });
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(facesOf(r, 'os1').map((f) => [f.name, Math.round(f.area)])).toEqual([[`${NAME1}#1`, 900]]);
  });

  it('the trimmed pieces go on into other features: the two pieces kept are knitted into one surface body of two faces', () => {
    let doc = insert(blocks(), trim({ discard: [faceRef(`${NAME1}#2`), faceRef(`${NAME2}#2`)] }));
    doc = insert(doc, { id: 'k1', type: 'knit', name: 'k1', suppressed: false, bodies: [body('os1'), body('os2')] } as Feature);
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(r.bodies.map((b) => [b.id, b.surface])).toEqual([['e1', false], ['os1', true]]);
    const faces = facesOf(r, 'os1');
    expect(faces).toHaveLength(2);
    expect(faces.reduce((a, f) => a + f.area, 0)).toBeCloseTo(750 + 360, 3);
  });

  it('says why when it cannot: planes that do not meet, a solid, the same body twice, a piece that is gone, every piece of a body taken away', () => {
    const parallel = insert(insert(blocks(), offset('os3', 'e1:cap:end', '-3')), trim({ b: body('os3') }));
    expect(status(rebuild(parallel), 'mt1')).toMatchObject({ status: 'error', message: expect.stringContaining('沒有交線') });
    expect(status(rebuild(insert(blocks(), trim({ a: body('e1') }))), 'mt1')).toMatchObject({ status: 'error', message: expect.stringContaining('是實體') });
    expect(status(rebuild(insert(blocks(), trim({ b: body('os1') }))), 'mt1')).toMatchObject({ status: 'error', message: expect.stringContaining('兩個不同') });
    expect(status(rebuild(insert(blocks(), trim({ a: body('nothing') }))), 'mt1')).toMatchObject({ status: 'error', message: expect.stringContaining('找不到') });
    expect(status(rebuild(insert(blocks(), trim({ a: body('') }))), 'mt1').status).toBe('error');
    const lost = status(rebuild(insert(blocks(), trim({ discard: [faceRef('os1:nothing#9')] }))), 'mt1');
    expect(lost).toMatchObject({ status: 'error', message: expect.stringContaining('找不到了') });
    const all = status(rebuild(insert(blocks(), trim({ discard: [faceRef(`${NAME1}#1`), faceRef(`${NAME1}#2`)] }))), 'mt1');
    expect(all).toMatchObject({ status: 'error', message: expect.stringContaining('至少要留一片') });
  });

  it('is not made when the surfaces lie on each other: the same plane twice', () => {
    const doc = insert(insert(blocks(), offset('os3', 'e1:cap:end', '-8')), trim({ b: body('os3') }));
    expect(status(rebuild(doc), 'mt1')).toMatchObject({ status: 'error', message: expect.stringContaining('疊在一起') });
  });

  it('the commands: the version is 46, setMutualTrim changes the bodies and the pieces, and takes them away again; only bodies and faces', () => {
    let doc = insert(blocks(), trim());
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    doc = applyCommand(doc, { type: 'setMutualTrim', featureId: 'mt1', a: body('os1'), b: body('os2'), discard: [faceRef(`${NAME1}#2`)] });
    expect(doc.features.find((f) => f.id === 'mt1')).toMatchObject({ discard: [faceRef(`${NAME1}#2`)] });
    doc = applyCommand(doc, { type: 'setMutualTrim', featureId: 'mt1', a: body('os1'), b: body('os2') });
    expect(doc.features.find((f) => f.id === 'mt1')).not.toHaveProperty('discard');
    expect(() => applyCommand(doc, { type: 'setMutualTrim', featureId: 'mt1', a: { kind: 'face', name: 'x' }, b: body('os2') })).toThrow();
    expect(() => applyCommand(doc, { type: 'setMutualTrim', featureId: 'mt1', a: body('os1'), b: body('os2'), discard: [body('os1')] })).toThrow();
    expect(() => insert(blocks(), trim({ b: { kind: 'edge', name: 'x' } }))).toThrow();
  });
});

describe('mutual trim in the kernel (P-3)', () => {
  const made: ShapeId[] = [];
  afterAll(() => made.forEach((s) => kernel.release(s)));
  const circle = (r: number): Region => ({ outer: [{ kind: 'circle', c: [0, 0], r, source: 'c' }], holes: [] });
  const sideOf = (solid: ShapeId, area: number): ShapeId => {
    made.push(solid);
    const id = kernel.subShape(solid, 'face', kernel.topology(solid).faces.findIndex((f) => Math.abs(f.area - area) < 1e-3));
    made.push(id);
    return id;
  };

  it('a thin cylinder (R6 along x) through a thick one (R10 along z, the seam of its side at x = 10): the hole across the seam is one patch, not two: 3 pieces of the thick side, 3 of the thin, no area lost', () => {
    const thick = sideOf(kernel.extrude({ origin: [0, 0, -20], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] }, [circle(10)], [0, 0, 40]).shape, 2 * Math.PI * 10 * 40);
    const thin = sideOf(kernel.extrude({ origin: [-20, 0, 0], xDir: [0, 1, 0], yDir: [0, 0, 1], normal: [1, 0, 0] }, [circle(6)], [40, 0, 0]).shape, 2 * Math.PI * 6 * 40);
    const r = kernel.trimSurfaces(thick, thin);
    made.push(r.a.shape, r.b.shape);
    const a = kernel.topology(r.a.shape).faces;
    const b = kernel.topology(r.b.shape).faces;
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    expect(a.reduce((x, f) => x + f.area, 0)).toBeCloseTo(2 * Math.PI * 10 * 40, 1);
    expect(b.reduce((x, f) => x + f.area, 0)).toBeCloseTo(2 * Math.PI * 6 * 40, 1);
    // every piece says which face it came from (there is one), as 'modified' because the face was cut
    expect(r.a.faceOrigins.every((o) => o.length === 1 && o[0]!.rel === 'modified')).toBe(true);
    expect(kernel.solidCount(r.a.shape)).toBe(0);
  });

  it('a solid is refused; a face whose pieces were not touched says "same"', () => {
    const solid = kernel.extrude({ origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] }, [circle(5)], [0, 0, 5]).shape;
    made.push(solid);
    const plane = kernel.subShape(solid, 'face', kernel.topology(solid).faces.findIndex((f) => Math.abs(f.area - Math.PI * 25) < 1e-3));
    made.push(plane);
    expect(() => kernel.trimSurfaces(solid, plane)).toThrow(/實體/);
  });
});

describe('mutual trim, and what comes after it (P-3)', () => {
  it('thicken goes on from the knitted pieces: the bent surface of 750 + 360 is a solid body of one thickness', () => {
    let doc = insert(blocks(), trim({ discard: [faceRef(`${NAME1}#2`), faceRef(`${NAME2}#2`)] }));
    doc = insert(doc, { id: 'k1', type: 'knit', name: 'k1', suppressed: false, bodies: [body('os1'), body('os2')] } as Feature);
    doc = insert(doc, { id: 'th1', type: 'thicken', name: 'th1', suppressed: false, body: body('os1'), thickness: '1' } as Feature);
    const r = rebuild(doc);
    expect(statuses(r).filter((x) => !x.endsWith('=ok'))).toEqual([]);
    const b = r.bodies.find((x) => x.id === 'os1')!;
    expect(b.surface).toBe(false);
    // a valid solid of one piece (thicken checks it); its volume is not asserted here: the corner of a sharp bend is the offset's (see ADR 0109, limits), and one piece alone is exact
    expect(kernel.solidCount(b.shape)).toBe(1);
    expect(kernel.isValid(b.shape)).toBe(true);
    expect(kernel.massProps(b.shape).volume).toBeGreaterThan(750);
    expect(kernel.massProps(b.shape).volume).toBeLessThan(1140 + 1e-6); // the mitred L: 38 across × 30
  });

  it('one piece alone thickens exactly: the 750 of os1 one thick is 750 mm³', () => {
    let doc = insert(blocks(), trim({ discard: [faceRef(`${NAME1}#2`)] }));
    doc = insert(doc, { id: 'th1', type: 'thicken', name: 'th1', suppressed: false, body: body('os1'), thickness: '1' } as Feature);
    const r = rebuild(doc);
    expect(statuses(r).filter((x) => !x.endsWith('=ok'))).toEqual([]);
    expect(kernel.massProps(r.bodies.find((x) => x.id === 'os1')!.shape).volume).toBeCloseTo(750, 4);
  });
});
