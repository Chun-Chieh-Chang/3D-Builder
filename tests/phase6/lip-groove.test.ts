/**
 * 6-5 (docs/phase6-plan.md): the lip and the groove (C4.11) — a ring on the rim of a shell that follows its outline, from the offset of the outline — against rings worked
 * out by hand on a box 60 × 40 × 30 shelled 2 (the rim is 2 wide): the ring between the outline offset 0.5 and 1.5 is 192 mm², a lip 1.2 high 230.4 mm³; and on one whose
 * vertical edges are rounded R5, where the outline has arcs and the ring is 192 − (4 − π)(4.5² − 3.5²) = 185.13 mm².
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, SCHEMA_VERSION, type Feature, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, edge, extrude, fillet, front, rectangle, sketch, statuses } from '../phase1/builders';

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
const volume = (r: RebuildResult) => kernel.massProps(r.body!.shape).volume;
const face = (name: string) => ({ kind: 'face' as const, name });
const SHELLED = 15552; // 72000 − 56·36·28

const shelled = (rounded = false, width = 60) => {
  const features: Feature[] = [sketch('s', front, rectangle('r', -width / 2, -20, width, 40)), extrude('e', 's', 'boss', { type: 'blind', depth: '30' })];
  if (rounded) {
    const pairs = [['rl0', 'rl1'], ['rl1', 'rl2'], ['rl2', 'rl3'], ['rl0', 'rl3']] as const;
    features.push(fillet('f1', pairs.map(([a, b]) => edge(`{e:side:s.${a}|e:side:s.${b}}`)), '5'));
  }
  features.push({ id: 'sh1', type: 'shell', name: 'sh1', suppressed: false, faces: [face('e:cap:end')], thickness: '2' } as Feature);
  return features;
};
/** The name of the rim of the shell (the face round the opening, at z = 30). */
function rimOf(features: Feature[]): string {
  const r = rebuild(build(...features));
  const i = r.body!.topology.faces.findIndex((f) => f.normal && f.normal[2] > 0.99 && Math.abs(f.center[2] - 30) < 1e-6);
  expect(i).toBeGreaterThanOrEqual(0);
  return r.body!.names.faces[i]!;
}
const ring = (rim: string, kind: 'lip' | 'groove', offset: string, width: string, height: string, id = 'lg1'): Feature =>
  ({ id, type: 'lipGroove', name: id, suppressed: false, face: face(rim), kind, offset, width, height }) as Feature;

describe('a lip on the rim of a shell', () => {
  let features: Feature[];
  let rim: string;
  beforeAll(() => {
    features = shelled();
    rim = rimOf(features);
  });

  it('the ring between the outline offset 0.5 and 1.5 is 192 mm², and the lip 1.2 high is 230.4 mm³ on the body: one solid, valid', () => {
    const r = rebuild(build(...features, ring(rim, 'lip', '0.5', '1', '1.2')));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(SHELLED + 192 * 1.2, 6);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(r.features.find((f) => f.id === 'lg1')!.info).toMatch(/唇：環的面積 192\.00 mm²、體積 230\.40/);
    // the far end of the lip is a ring of 192 at z = 31.2, named after the feature
    const names = r.body!.names.faces;
    const end = r.body!.topology.faces[names.indexOf('lg1:cap:end')]!;
    expect(end.area).toBeCloseTo(192, 6);
    expect(end.center[2]).toBeCloseTo(31.2, 6);
    // the sides are named after the edge of the outline they came from, the outside of the ring and the inside (~): eight of them in all, four and four
    const sides = names.filter((n) => n.startsWith('lg1:side:ring.'));
    expect(sides).toHaveLength(8);
    expect(sides.filter((n) => n.includes('~'))).toHaveLength(4);
    expect(new Set(names).size).toBe(names.length);
  });

  it('a groove of the same ring cut 1.2 deep takes the same volume away', () => {
    const r = rebuild(build(...features, ring(rim, 'groove', '0.5', '1', '1.2')));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(SHELLED - 192 * 1.2, 6);
    expect(r.body!.names.faces).toContain('lg1:cap:end');
    expect(r.body!.topology.faces[r.body!.names.faces.indexOf('lg1:cap:end')]!.center[2]).toBeCloseTo(28.8, 6);
  });

  it('with no offset the ring starts at the outline: 60 × 40 less 58 × 38 = 196 mm²', () => {
    const r = rebuild(build(...features, ring(rim, 'lip', '0', '1', '1')));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(SHELLED + 196, 6);
  });

  it('follows the model: the box made 70 wide, the ring is 69 × 39 less 67 × 37 = 212 mm², the same names', () => {
    const narrow = rebuild(build(...features, ring(rim, 'lip', '0.5', '1', '1.2')));
    const wideFeatures = shelled(false, 70);
    const wide = rebuild(build(...wideFeatures, ring(rimOf(wideFeatures), 'lip', '0.5', '1', '1.2')));
    expect(failures(wide)).toEqual([]);
    expect(volume(wide)).toBeCloseTo(70 * 40 * 30 - 66 * 36 * 28 + 212 * 1.2, 6);
    expect(wide.body!.names.faces.filter((n) => n.startsWith('lg1:')).sort()).toEqual(narrow.body!.names.faces.filter((n) => n.startsWith('lg1:')).sort());
  });
});

describe('a lip on a rim whose outline has arcs (the vertical edges rounded R5)', () => {
  it('the ring between the outline offset 0.5 and 1.5 is 192 − (4 − π)(4.5² − 3.5²) = 185.13 mm², the lip 222.16 mm³; the groove takes the same away', () => {
    const features = shelled(true);
    const rim = rimOf(features);
    const area = 192 - (4 - Math.PI) * (4.5 ** 2 - 3.5 ** 2);
    const lip = rebuild(build(...features, ring(rim, 'lip', '0.5', '1', '1.2')));
    expect(failures(lip)).toEqual([]);
    expect(kernel.isValid(lip.body!.shape)).toBe(true);
    const base = volume(rebuild(build(...features)));
    expect(volume(lip) - base).toBeCloseTo(area * 1.2, 5);
    expect(lip.body!.topology.faces[lip.body!.names.faces.indexOf('lg1:cap:end')]!.area).toBeCloseTo(area, 5);
    // eight sides again: four straight and four arcs on each side of the ring
    expect(lip.body!.names.faces.filter((n) => n.startsWith('lg1:side:ring.'))).toHaveLength(16);
    const groove = rebuild(build(...features, ring(rim, 'groove', '0.5', '1', '1.2')));
    expect(failures(groove)).toEqual([]);
    expect(base - volume(groove)).toBeCloseTo(area * 1.2, 5);
  });
});

describe('what is refused', () => {
  let features: Feature[];
  let rim: string;
  beforeAll(() => {
    features = shelled();
    rim = rimOf(features);
  });
  const message = (doc: PartDoc) => rebuild(doc).features.find((f) => f.id === 'lg1')!;

  it('a ring that does not lie on the face: it runs into the cavity (0.5 + 2 is more than the rim is wide)', () => {
    expect(message(build(...features, ring(rim, 'lip', '0.5', '2', '1')))).toMatchObject({ status: 'error', message: expect.stringContaining('超出') });
  });

  it('an offset larger than the face: the outline cannot be offset in so far', () => {
    expect(message(build(...features, ring(rim, 'lip', '40', '1', '1')))).toMatchObject({ status: 'error', message: expect.stringContaining('偏移') });
  });

  it('a face that is not planar, and a face that is gone', () => {
    const cylinder = [sketch('s', front, circle('c', 0, 0, 20)), extrude('e', 's', 'boss', { type: 'blind', depth: '30' })];
    expect(message(build(...cylinder, ring('e:side:s.c', 'lip', '0.5', '1', '1')))).toMatchObject({ status: 'error', message: expect.stringContaining('平面') });
    expect(message(build(...features, ring('e:side:nowhere', 'lip', '0.5', '1', '1')))).toMatchObject({ status: 'error', message: expect.stringContaining('找不到') });
  });

  it('a width or height that is not above 0, an offset below 0, and a ring on something that is not a face, are refused where they are given', () => {
    expect(() => build(...features, ring(rim, 'lip', '0.5', '0', '1'))).toThrow();
    expect(() => build(...features, ring(rim, 'lip', '0.5', '1', '-1'))).toThrow();
    expect(() => build(...features, ring(rim, 'lip', '-0.1', '1', '1'))).toThrow(/不能是負/);
    expect(() => build(...features, { ...ring(rim, 'lip', '0.5', '1', '1'), face: { kind: 'edge', name: 'x' } } as Feature)).toThrow();
  });
});

describe('the command and the file', () => {
  it('setLipGroove changes the face, the kind and the sizes; the version is 33; an expression follows its variable', () => {
    const features = shelled();
    const rim = rimOf(features);
    let doc = build(...features, ring(rim, 'lip', '0.5', '1', '1.2'));
    doc = applyCommand(doc, { type: 'setLipGroove', featureId: 'lg1', face: face(rim), kind: 'groove', offset: '0', width: '1', height: '1' });
    expect(doc.features.find((f) => f.id === 'lg1')).toMatchObject({ kind: 'groove', offset: '0' });
    expect(volume(rebuild(doc))).toBeCloseTo(SHELLED - 196, 6);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(() => applyCommand(doc, { type: 'setLipGroove', featureId: 'lg1', face: { kind: 'edge', name: 'x' }, kind: 'lip', offset: '0', width: '1', height: '1' })).toThrow();
  });
});
