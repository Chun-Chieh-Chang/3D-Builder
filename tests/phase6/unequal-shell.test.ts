/**
 * 6-4 (docs/phase6-plan.md): walls of another thickness on a shell (C5.4) — the body shelled with one thickness, then the inner face against each face given another
 * moved — against the volumes worked out by hand on a box 60 × 40 × 30 shelled open at the top: floor 4, one wall 3, one wall 1, both; names that follow the model; and
 * the refusals (an opened face, a curved wall, a wall that does not fit).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, SCHEMA_VERSION, type Feature, type PartDoc, type ShellFeature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, extrude, front, rectangle, sketch, statuses } from '../phase1/builders';

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
const TOP = 'e:cap:end';
const FLOOR = 'e:cap:start';
const RIGHT = 'e:side:s.rl1'; // x = +30
const LEFT = 'e:side:s.rl3'; // x = −30

/** A box 60 × 40 × 30 (x −30…30, y −20…20, z 0…30) shelled 2, open at the top, the walls behind `walls` (face name → thickness) another thickness. */
const box = (walls: Record<string, string> = {}, width = 60): PartDoc =>
  build(sketch('s', front, rectangle('r', -width / 2, -20, width, 40)), extrude('e', 's', 'boss', { type: 'blind', depth: '30' }), {
    id: 'sh1',
    type: 'shell',
    name: 'sh1',
    suppressed: false,
    faces: [face(TOP)],
    thickness: '2',
    ...(Object.keys(walls).length > 0 ? { faceThickness: Object.entries(walls).map(([name, thickness]) => ({ face: face(name), thickness })) } : {}),
  } as Feature);

describe('a box 60 × 40 × 30 shelled 2, open at the top', () => {
  it('as it is: 72000 − 56·36·28 = 15552', () => {
    const r = rebuild(box());
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(72000 - 56 * 36 * 28, 6);
  });

  it('with the floor 4 thick: 72000 − 56·36·26 = 19584, valid, the same faces', () => {
    const uniform = rebuild(box());
    const r = rebuild(box({ [FLOOR]: '4' }));
    expect(failures(r)).toEqual([]);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(volume(r)).toBeCloseTo(19584, 6);
    expect(r.body!.topology.faces).toHaveLength(uniform.body!.topology.faces.length);
  });

  it('with the wall on the +x side 3 thick: 72000 − 55·36·28 = 16560; with the one on −x 1 thick (thinner than the rest): 72000 − 57·36·28 = 14544', () => {
    expect(volume(rebuild(box({ [RIGHT]: '3' })))).toBeCloseTo(72000 - 55 * 36 * 28, 6);
    const thin = rebuild(box({ [LEFT]: '1' }));
    expect(failures(thin)).toEqual([]);
    expect(volume(thin)).toBeCloseTo(72000 - 57 * 36 * 28, 6);
  });

  it('with the floor 4 and the +x wall 3 together: 72000 − 55·36·26 = 20520 (one move does not lose the next)', () => {
    const r = rebuild(box({ [FLOOR]: '4', [RIGHT]: '3' }));
    expect(failures(r)).toEqual([]);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(volume(r)).toBeCloseTo(72000 - 55 * 36 * 26, 6);
  });

  it('a wall given the thickness of the rest is left as it is', () => {
    expect(volume(rebuild(box({ [FLOOR]: '2' })))).toBeCloseTo(72000 - 56 * 36 * 28, 6);
  });

  it('the inner face of a wall keeps the name the shell gave it, and the names follow the model: the box made 70 wide, the floor 4 thick, the same names and 84000 − 66·36·26', () => {
    const narrow = rebuild(box({ [FLOOR]: '4' }));
    const wide = rebuild(box({ [FLOOR]: '4' }, 70));
    expect(failures(wide)).toEqual([]);
    expect(volume(wide)).toBeCloseTo(70 * 40 * 30 - 66 * 36 * 26, 6);
    expect(wide.body!.names.faces.slice().sort()).toEqual(narrow.body!.names.faces.slice().sort());
    expect(narrow.body!.names.faces.filter((n) => n.startsWith('sh1:shell:'))).toContain(`sh1:shell:${FLOOR}`);
  });
});

describe('the refusals', () => {
  it('a face that is taken away cannot have a wall of its own; nor a face that is gone', () => {
    const open = rebuild(box({ [TOP]: '3' }));
    expect(open.features.find((f) => f.id === 'sh1')).toMatchObject({ status: 'error', message: expect.stringContaining('打開') });
    const gone = rebuild(box({ 'e:side:nowhere': '3' }));
    expect(gone.features.find((f) => f.id === 'sh1')).toMatchObject({ status: 'error', message: expect.stringContaining('找不到') });
  });

  it('a curved wall: the shell of a cylinder with a thicker side says planar walls only', () => {
    const doc = build(sketch('s', front, circle('c', 0, 0, 20)), extrude('e', 's', 'boss', { type: 'blind', depth: '30' }), {
      id: 'sh1',
      type: 'shell',
      name: 'sh1',
      suppressed: false,
      faces: [face(TOP)],
      thickness: '2',
      faceThickness: [{ face: face('e:side:s.c'), thickness: '3' }],
    } as Feature);
    const r = rebuild(doc);
    expect(r.features.find((f) => f.id === 'sh1')).toMatchObject({ status: 'error', message: expect.stringContaining('平面') });
    // and the same cylinder without it is made
    expect(failures(rebuild(applyCommand(doc, { type: 'setShell', featureId: 'sh1', faces: [face(TOP)], thickness: '2', faceThickness: [] })))).toEqual([]);
  });

  it('a wall that does not fit (a floor 40 thick in a body 30 high) is refused with the reason; a thickness of 0 or less is refused where it is given', () => {
    const r = rebuild(box({ [FLOOR]: '40' }));
    expect(r.features.find((f) => f.id === 'sh1')).toMatchObject({ status: 'error', message: expect.stringContaining('個別壁厚') });
    expect(() => box({ [FLOOR]: '0' })).toThrow();
    expect(() => box({ [FLOOR]: '-1' })).toThrow();
  });
});

describe('the command and the file', () => {
  it('setShell without faceThickness leaves the walls as they are, with a list changes them, with an empty one takes them away; only faces are taken', () => {
    let doc = box({ [FLOOR]: '4' });
    const get = () => (doc.features.find((f) => f.id === 'sh1') as ShellFeature).faceThickness;
    doc = applyCommand(doc, { type: 'setShell', featureId: 'sh1', faces: [face(TOP)], thickness: '2.5' });
    expect(get()).toEqual([{ face: face(FLOOR), thickness: '4' }]);
    doc = applyCommand(doc, { type: 'setShell', featureId: 'sh1', faces: [face(TOP)], thickness: '2', faceThickness: [{ face: face(RIGHT), thickness: '3' }] });
    expect(get()).toEqual([{ face: face(RIGHT), thickness: '3' }]);
    expect(volume(rebuild(doc))).toBeCloseTo(72000 - 55 * 36 * 28, 6);
    expect(() => applyCommand(doc, { type: 'setShell', featureId: 'sh1', faces: [face(TOP)], thickness: '2', faceThickness: [{ face: { kind: 'edge', name: 'x' }, thickness: '3' }] })).toThrow();
    doc = applyCommand(doc, { type: 'setShell', featureId: 'sh1', faces: [face(TOP)], thickness: '2', faceThickness: [] });
    expect(get()).toBeUndefined();
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('an expression for the thickness of a wall follows the variable it uses: floor = 4 gives 19584, floor = 3 gives 72000 − 56·36·27', () => {
    // the variable is in the part before the shell that uses it
    const features = box().features.filter((f) => f.type !== 'shell');
    const shell = { ...(box().features.find((f) => f.type === 'shell') as ShellFeature), faceThickness: [{ face: face(FLOOR), thickness: 'floor' }] };
    let doc = applyCommand(createEmptyPart(), { type: 'addVariable', variable: { id: 'var1', name: 'floor', expr: '4' } });
    [...features, shell].forEach((feature, index) => {
      doc = applyCommand(doc, { type: 'insertFeature', feature, index });
    });
    expect(volume(rebuild(doc))).toBeCloseTo(19584, 6);
    doc = applyCommand(doc, { type: 'setVariable', id: 'var1', expr: '3' });
    expect(volume(rebuild(doc))).toBeCloseTo(72000 - 56 * 36 * 27, 6);
  });
});
