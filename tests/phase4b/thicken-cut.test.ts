/**
 * 4b-5 (docs/phase4b-plan.md): thicken and cut with surface (C9.4) — the gauge block made from an offset surface, and a solid cut along a surface — and the two rules the
 * surface bodies still needed: a derived body that is a surface in its master stays one, and a shape with offset surfaces is converted to B-splines for STEP, or written
 * as it is with a warning when the converter stops. Volumes and areas are worked out by hand.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, SCHEMA_VERSION, type Feature, type PartDoc, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { exportPartStep, portableShape } from '@3db/io';
import { Regenerator, type RebuildResult, type SourcePart, type SourceProvider } from '@3db/regen';
import { build, circle, extrude, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const rebuild = (doc: PartDoc, sources?: SourceProvider): RebuildResult => {
  const regen = new Regenerator(kernel, solver, new Map(), sources);
  kept.push(regen);
  return regen.rebuild(doc);
};
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const status = (r: RebuildResult, id: string) => r.features.find((f) => f.id === id)!;
const volume = (r: RebuildResult, id: string) => kernel.massProps(r.bodies.find((b) => b.id === id)!.shape).volume;
const area = (r: RebuildResult, id: string) => kernel.topology(r.bodies.find((b) => b.id === id)!.shape).faces.reduce((a, f) => a + f.area, 0);
const insert = (doc: PartDoc, feature: Feature): PartDoc => applyCommand(doc, { type: 'insertFeature', feature, index: doc.features.length } as never);
const body = (name: string): Ref => ({ kind: 'body', name });

const SIDE = 'e1:side:s1.c';
const offset = (distance = '3'): Feature => ({ id: 'os1', type: 'offsetSurface', name: 'os1', suppressed: false, faces: [{ kind: 'face', name: SIDE }], distance }) as Feature;
/** A cylinder R10 and 20 long (z from 0 to 20), and the side of it offset by 3: a surface of R13. */
const cylinder = (distance = '3', radius = 10): PartDoc => build(sketch('s1', front, circle('c', 0, 0, radius)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }), offset(distance));
const thicken = (thickness: string, id = 'th1', target = 'os1'): Feature => ({ id, type: 'thicken', name: id, suppressed: false, body: body(target), thickness }) as Feature;

describe('thicken (C9.4)', () => {
  it('the surface R13 thickened out by 2 is the wall between R13 and R15, π(15² − 13²)·20, in the place of the surface: a solid body; in by 2, between R11 and R13', () => {
    const r = rebuild(insert(cylinder(), thicken('2')));
    expect(failures(r)).toEqual([]);
    expect(r.bodies.map((b) => [b.id, b.surface])).toEqual([['e1', false], ['os1', false]]);
    expect(kernel.solidCount(r.bodies[1]!.shape)).toBe(1);
    expect(volume(r, 'os1')).toBeCloseTo(Math.PI * (225 - 169) * 20, 3);
    expect(status(r, 'th1').info).toMatch(/離曲面最遠 2\.000 mm/);
    const inward = rebuild(insert(cylinder(), thicken('-2')));
    expect(failures(inward)).toEqual([]);
    expect(volume(inward, 'os1')).toBeCloseTo(Math.PI * (169 - 121) * 20, 3);
  });

  it('names its faces: the surface keeps the name it had, the offset face and the walls round the edges are named after the feature, and they follow the model', () => {
    const r = rebuild(insert(cylinder(), thicken('2')));
    const names = r.body!.names.faces.filter((n) => !n.startsWith('e1:'));
    expect(names).toHaveLength(4);
    expect(names).toContain(`os1:offset:${SIDE}`);
    expect(names.filter((n) => n.startsWith('th1:thicken:'))).toHaveLength(3);
    expect(new Set(names).size).toBe(4);
    // the cylinder 12 thick radius and the offset 5: the solid is the wall between R17 and R19, with the same names
    let doc = insert(cylinder(), thicken('2'));
    const s = doc.features.find((f) => f.id === 's1');
    const radius = s?.type === 'sketch' ? s.constraints.find((c) => c.type === 'radius') : undefined;
    doc = applyCommand(doc, { type: 'setDimension', featureId: 's1', constraintId: radius!.id, value: '12' });
    doc = applyCommand(doc, { type: 'setOffsetSurface', featureId: 'os1', faces: [{ kind: 'face', name: SIDE }], distance: '5' });
    const after = rebuild(doc);
    expect(failures(after)).toEqual([]);
    expect(volume(after, 'os1')).toBeCloseTo(Math.PI * (19 ** 2 - 17 ** 2) * 20, 3);
    expect(after.body!.names.faces.filter((n) => !n.startsWith('e1:')).sort()).toEqual(names.slice().sort());
  });

  it('says why when it cannot: a solid body, a body that is gone, none picked, a thickness the surface cannot bear', () => {
    expect(status(rebuild(insert(cylinder(), thicken('2', 'th1', 'e1'))), 'th1')).toMatchObject({ status: 'error', message: expect.stringContaining('實體') });
    expect(status(rebuild(insert(cylinder(), thicken('2', 'th1', 'nothing'))), 'th1')).toMatchObject({ status: 'error', message: expect.stringContaining('找不到') });
    expect(status(rebuild(insert(cylinder(), { ...thicken('2'), body: body('') } as Feature)), 'th1').status).toBe('error');
    expect(() => insert(cylinder(), thicken('0'))).toThrow(/不能是 0/);
    expect(() => insert(cylinder(), { ...thicken('2'), body: { kind: 'face', name: 'x' } } as Feature)).toThrow();
  });

  it('the commands: the version is 31, and setThicken changes the body and the thickness', () => {
    let doc = insert(cylinder(), thicken('2'));
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    doc = applyCommand(doc, { type: 'setThicken', featureId: 'th1', body: body('os1'), thickness: '4' });
    expect(doc.features.find((f) => f.id === 'th1')).toMatchObject({ thickness: '4' });
    expect(() => applyCommand(doc, { type: 'setThicken', featureId: 'th1', body: { kind: 'edge', name: 'x' }, thickness: '4' })).toThrow();
  });
});

describe('cut with surface (C9.4)', () => {
  /** A block 40 × 30 × 20 (z from 0 to 20) and the surface of its top offset 8 down (z = 12), made larger by 10 past each edge: a plane that clears the block. */
  const block = (): PartDoc => build(sketch('s1', front, rectangle('r', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }), { id: 'os1', type: 'offsetSurface', name: 'os1', suppressed: false, faces: [{ kind: 'face', name: 'e1:cap:end' }], distance: '-8' } as Feature);
  const edgesOf = (r: RebuildResult, id: string): Ref[] => {
    const b = r.bodies.find((x) => x.id === id)!;
    return r.body!.names.edges.slice(b.edge0, b.edge0 + b.edges).map((name) => ({ kind: 'edge', name }));
  };
  const wide = (doc: PartDoc): PartDoc => insert(doc, { id: 'ex1', type: 'extendSurface', name: 'ex1', suppressed: false, edges: edgesOf(rebuild(doc), 'os1'), distance: '10' } as Feature);
  const cut = (extra: Partial<Feature> = {}): Feature => ({ id: 'cs1', type: 'cutWithSurface', name: 'cs1', suppressed: false, target: body('e1'), surface: body('os1'), direction: { kind: 'datum', name: 'plane:front' }, ...extra }) as Feature;

  it('the block cut along the surface at z = 12: the part above it goes (40 × 30 × 12 left), the surface stays, and the new face is the surface, named after it', () => {
    const r = rebuild(insert(wide(block()), cut()));
    expect(failures(r)).toEqual([]);
    expect(volume(r, 'e1')).toBeCloseTo(40 * 30 * 12, 4);
    expect(r.bodies.map((b) => [b.id, b.surface])).toEqual([['e1', false], ['os1', true]]);
    const cutFace = r.body!.names.faces.filter((n) => n.startsWith('cs1:cut:'));
    expect(cutFace).toHaveLength(1);
    const face = r.body!.topology.faces[r.body!.names.faces.indexOf(cutFace[0]!)]!;
    expect(face.area).toBeCloseTo(40 * 30, 4);
    expect(face.center[2]).toBeCloseTo(12, 6);
    // the surface is as it was: the plane 60 × 50
    expect(area(r, 'os1')).toBeCloseTo(60 * 50, 4);
  });

  it('reversed, the other side goes: 40 × 30 × 8 is left, the top of the block', () => {
    const r = rebuild(insert(wide(block()), cut({ reverse: true })));
    expect(failures(r)).toEqual([]);
    expect(volume(r, 'e1')).toBeCloseTo(40 * 30 * 8, 4);
  });

  it('follows the model: the surface 5 down instead of 8, the block is 40 × 30 × 15', () => {
    let doc = insert(wide(block()), cut());
    doc = applyCommand(doc, { type: 'setOffsetSurface', featureId: 'os1', faces: [{ kind: 'face', name: 'e1:cap:end' }], distance: '-5' });
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(volume(r, 'e1')).toBeCloseTo(40 * 30 * 15, 4);
  });

  it('a surface that does not reach the block takes nothing and says so; a surface the size of the block still cuts it', () => {
    const above = build(sketch('s1', front, rectangle('r', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }), { id: 'os1', type: 'offsetSurface', name: 'os1', suppressed: false, faces: [{ kind: 'face', name: 'e1:cap:end' }], distance: '30' } as Feature);
    expect(status(rebuild(insert(above, cut())), 'cs1')).toMatchObject({ status: 'error', message: expect.stringContaining('除料') });
    const same = rebuild(insert(block(), cut()));
    expect(failures(same)).toEqual([]);
    expect(volume(same, 'e1')).toBeCloseTo(40 * 30 * 12, 3);
  });

  it('says why when it cannot: a surface as the solid, a solid as the surface, a body that is gone, a direction that is not a plane', () => {
    const doc = wide(block());
    expect(status(rebuild(insert(doc, cut({ target: body('os1') }))), 'cs1')).toMatchObject({ status: 'error', message: expect.stringContaining('不是實體') });
    expect(status(rebuild(insert(doc, cut({ surface: body('e1') }))), 'cs1')).toMatchObject({ status: 'error', message: expect.stringContaining('除料要用曲面本體') });
    expect(status(rebuild(insert(doc, cut({ surface: body('nothing') }))), 'cs1')).toMatchObject({ status: 'error', message: expect.stringContaining('找不到') });
    expect(() => insert(doc, cut({ direction: { kind: 'edge', name: 'x' } }))).toThrow();
    expect(() => insert(doc, cut({ target: { kind: 'face', name: 'x' } }))).toThrow();
  });

  it('the command changes it: setCutWithSurface flips the direction', () => {
    let doc = insert(wide(block()), cut());
    doc = applyCommand(doc, { type: 'setCutWithSurface', featureId: 'cs1', target: body('e1'), surface: body('os1'), direction: { kind: 'datum', name: 'plane:front' }, reverse: true });
    expect(doc.features.find((f) => f.id === 'cs1')).toMatchObject({ reverse: true });
    expect(volume(rebuild(doc), 'e1')).toBeCloseTo(40 * 30 * 8, 4);
  });
});

describe('a derived body that is a surface (4b-5)', () => {
  it('stays a surface body, as it is in the master: no solid, and not a part', () => {
    const masterDoc = cylinder();
    const sources: SourceProvider = { get: (path): SourcePart | undefined => (path === '工件.3dbx' ? { key: path, doc: masterDoc, blobs: new Map() } : undefined) };
    const derived = applyCommand(createEmptyPart(), { type: 'insertFeature', feature: { id: 'd1', type: 'derivedBody', name: 'd1', suppressed: false, source: '工件.3dbx', body: 'os1' }, index: 0 });
    const r = rebuild(derived, sources);
    expect(failures(r)).toEqual([]);
    expect(r.bodies.map((b) => [b.id, b.surface])).toEqual([['d1', true]]);
    expect(kernel.solidCount(r.bodies[0]!.shape)).toBe(0);
  });
});

describe('STEP out of offset surfaces (4b-5)', () => {
  const lofted = (radii: number[]): ShapeId => {
    const plane = (id: string, z: number): Feature => ({ id, type: 'refPlane', name: id, suppressed: false, def: { mode: 'offset', plane: front, distance: String(z) } }) as Feature;
    const features: Feature[] = [];
    radii.forEach((r, i) => {
      if (i > 0) features.push(plane(`pl${i}`, 30 * i));
      features.push(sketch(`s${i}`, i === 0 ? front : { kind: 'datum', name: `pl${i}` }, circle(`c${i}`, 0, 0, r)));
    });
    return rebuild(build(...features, { id: 'lf1', type: 'loft', name: 'lf1', suppressed: false, sections: radii.map((_, i) => `s${i}`), op: 'boss' } as Feature)).body!.shape;
  };
  const kinds = (shape: ShapeId) => kernel.topology(shape).faces.map((f) => f.surface);

  it('the offset of a freeform side is OCCT offset surfaces; portable, it is B-splines with the same faces in the same order, and the STEP of it reads back with the same area', () => {
    const solid = lofted([25, 15, 22]);
    const side = kernel.topology(solid).faces.findIndex((f) => f.surface === 'bsplinesurface');
    const off = kernel.offsetFaces(solid, [side], 3);
    expect(kinds(off.shape)).toContain('offsetsurface');
    const fit = portableShape(kernel, off.shape);
    expect(fit.converted).toBe(true);
    expect(kinds(fit.shape).every((k) => k === 'bsplinesurface')).toBe(true);
    const before = kernel.topology(off.shape).faces.map((f) => f.area);
    kernel.topology(fit.shape).faces.forEach((f, i) => expect(f.area).toBeCloseTo(before[i]!, 1));
    const warnings: string[] = [];
    const text = exportPartStep(kernel, [off.shape], 'form', { warnings });
    expect(warnings).toEqual([]);
    // what is written is B-splines: the offset surfaces as they are are another entity, which is what the conversion is for
    expect(kernel.exportStep(off.shape, 'form')).toContain('OFFSET_SURFACE');
    expect(text).not.toContain('OFFSET_SURFACE');
    expect(text).toContain('B_SPLINE_SURFACE');
  });

  it('a solid whose converter stops (the offset of a whole freeform solid) is written as it is, and the warning says so', () => {
    const off = kernel.offsetSolid(lofted([25, 15, 22]), 3);
    expect(kinds(off.shape)).toContain('offsetsurface');
    const fit = portableShape(kernel, off.shape);
    if (fit.converted) return; // the converter has been mended: nothing to warn of
    expect(fit.failed).toBe(true);
    const warnings: string[] = [];
    const text = exportPartStep(kernel, [off.shape], 'form', { warnings });
    expect(warnings).toEqual([expect.stringContaining('B 樣條')]);
    expect(text).toContain('ADVANCED_FACE');
  });

  it('a shape with no offset surfaces is written as it is, without a warning', () => {
    const fit = portableShape(kernel, lofted([25, 15]));
    expect(fit).toMatchObject({ converted: false, failed: false });
  });
});
