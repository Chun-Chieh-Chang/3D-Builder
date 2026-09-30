/**
 * B5.2, B5.3, B8.3 end to end: values that are expressions drive the model, one change reaches everything
 * that depends on it in one rebuild, and what cannot be evaluated is reported on the feature, not built wrong.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Command, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { dependencies } from '@3db/regen/dag';
import { build, circle, extrude, face, front, rectangle, sketch, statuses } from './builders';

let kernel: Kernel;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});

const run = (doc: PartDoc, ...commands: Command[]) => commands.reduce((d, c) => applyCommand(d, c), doc);
const volume = (doc: PartDoc) => {
  const r = regen.rebuild(doc);
  expect(statuses(r).filter((s) => !s.endsWith('=ok')), 'every feature builds').toEqual([]);
  return kernel.massProps(r.body!.shape).volume;
};

/** A 40 × 20 plate, extruded; its dimensions are `aw` (width) and `ad` (depth), named 「aw@s1」 and 「ad@s1」. */
const plate = () => build(sketch('s1', front, rectangle('a', 0, 0, 40, 20)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }));

describe('expressions drive the model', () => {
  it('a variable reaches a sketch dimension and an extrude depth in one rebuild', () => {
    let doc = run(
      plate(),
      { type: 'addVariable', variable: { id: 'var1', name: 'w', expr: '40' } },
      { type: 'addVariable', variable: { id: 'var2', name: 'wall', expr: 'w / 4' } },
      { type: 'setDimension', featureId: 's1', constraintId: 'aw', value: 'w' },
      { type: 'setDimension', featureId: 's1', constraintId: 'ad', value: 'w / 2' },
      { type: 'setEndCondition', featureId: 'e1', dir: 'dir1', value: { type: 'blind', depth: 'wall' } },
    );
    expect(volume(doc)).toBeCloseTo(40 * 20 * 10, 6);
    doc = run(doc, { type: 'setVariable', id: 'var1', expr: '60' });
    expect(volume(doc)).toBeCloseTo(60 * 30 * 15, 6); // 60 wide, 30 deep, 15 tall
  });

  it('a dimension of one sketch can drive another feature: 寬度@草圖', () => {
    let doc = run(plate(), { type: 'setEndCondition', featureId: 'e1', dir: 'dir1', value: { type: 'blind', depth: 'ad@s1 / 2' } });
    expect(volume(doc)).toBeCloseTo(40 * 20 * 10, 6);
    doc = run(doc, { type: 'setDimension', featureId: 's1', constraintId: 'ad', value: '30' });
    expect(volume(doc)).toBeCloseTo(40 * 30 * 15, 6);
  });

  it('units and functions work inside a feature', () => {
    const doc = run(plate(), { type: 'setEndCondition', featureId: 'e1', dir: 'dir1', value: { type: 'blind', depth: 'max(0.5in, 4mm) + sqrt(4mm*9mm)' } });
    expect(volume(doc)).toBeCloseTo(40 * 20 * (12.7 + 6), 6);
  });

  it('a file property is a value too', () => {
    const doc = run(plate(), { type: 'setProperty', name: '板厚', value: '7.5mm' }, { type: 'setEndCondition', featureId: 'e1', dir: 'dir1', value: { type: 'blind', depth: "property('板厚')" } });
    expect(volume(doc)).toBeCloseTo(40 * 20 * 7.5, 6);
  });

  it('an angle can be an expression', () => {
    // a plate rotated about an edge: the reference plane's angle comes from a variable
    const doc = run(plate(), { type: 'addVariable', variable: { id: 'var1', name: 'a', expr: '30deg + 15' } });
    const r = regen.rebuild(doc);
    expect(statuses(r).every((s) => s.endsWith('=ok'))).toBe(true);
  });
});

describe('what cannot be evaluated', () => {
  it('a document with a cycle in it (edited by hand) reports the cycle on the features that use it, and the rest still builds', () => {
    const doc = structuredClone(plate());
    doc.variables = [
      { id: 'var1', name: 'a', expr: 'b + 1' },
      { id: 'var2', name: 'b', expr: 'a + 1' },
    ];
    (doc.features[1] as { dir1: unknown }).dir1 = { type: 'blind', depth: 'a' };
    const r = regen.rebuild(doc);
    const e1 = r.features.find((f) => f.id === 'e1')!;
    expect(e1.status).toBe('error');
    expect(e1.message).toBe('循環引用：a → b → a');
    expect(r.features.find((f) => f.id === 's1')!.status).toBe('ok');
  });

  it('an unknown name fails that feature with the name, and does not build a wrong shape', () => {
    const doc = structuredClone(plate());
    (doc.features[1] as { dir1: unknown }).dir1 = { type: 'blind', depth: 'nope * 2' };
    const r = regen.rebuild(doc);
    expect(r.features.find((f) => f.id === 'e1')).toMatchObject({ status: 'error', message: '找不到變數「nope」' });
    expect(r.body).toBeNull();
  });

  it('a dimension that comes to zero or below is an error, not a degenerate sketch', () => {
    const doc = structuredClone(plate());
    (doc.features[0] as { constraints: { id: string; value?: string }[] }).constraints.find((c) => c.id === 'aw')!.value = '5 - 5';
    const r = regen.rebuild(doc);
    expect(r.features.find((f) => f.id === 's1')!.status).toBe('error');
  });
});

describe('who depends on whom', () => {
  it('an expression makes its feature a child of the sketch it reads, through variables too', () => {
    const doc = run(
      build(sketch('s1', front, rectangle('a', 0, 0, 40, 20)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }), sketch('s2', face('e1:cap:end'), circle('k', 20, 10, 3))),
      { type: 'addVariable', variable: { id: 'var1', name: 'r', expr: 'ad@s1 / 10' } },
      { type: 'setDimension', featureId: 's2', constraintId: 'kr', value: 'r + 1' },
    );
    const deps = dependencies(doc);
    expect(deps.parents.get('s2')).toEqual(expect.arrayContaining(['s1', 'e1']));
    expect(deps.children.get('s1')).toEqual(expect.arrayContaining(['s2']));
    expect(volume(doc)).toBeCloseTo(40 * 20 * 10, 6);
  });
});
