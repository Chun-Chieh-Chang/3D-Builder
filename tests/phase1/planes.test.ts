/**
 * Phase 1C (handoff §9): reference planes (C3.2) — offset, angle and three-point — and sketches and
 * features on them, rebuilt from documents and followed through upstream changes.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type PlaneDefinition, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { dependencies, Regenerator, suppressionTargets, type RebuildResult } from '@3db/regen';
import { build, circle, extrude, face, front, rectangle, sketch, statuses } from './builders';

let kernel: Kernel;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});

const plane = (id: string, def: PlaneDefinition): Feature => ({ id, type: 'refPlane', name: id, suppressed: false, def });
const onPlane = (id: string): Ref => ({ kind: 'datum', name: id });
const vertex = (name: string): Ref => ({ kind: 'vertex', name });
/** A 40 × 30 × 10 plate on the front plane (z from 0 to 10); sides al0 y = 0, al1 x = 40, al2 y = 30, al3 x = 0. */
const plate = (depth = '10'): Feature[] => [sketch('s1', front, rectangle('a', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth })];
const volume = (r: RebuildResult) => kernel.massProps(r.body!.shape).volume;
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

describe('offset planes', () => {
  it('offsets a default plane and builds a post down from it to the plate', () => {
    const doc = build(
      ...plate(),
      plane('p1', { mode: 'offset', plane: front, distance: '25' }),
      sketch('s2', onPlane('p1'), circle('k', 20, 15, 4)),
      extrude('e2', 's2', 'boss', { type: 'upToFace', face: face('e1:cap:end'), reverse: true }),
    );
    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 'p1=ok', 's2=ok', 'e2=ok']);
    expect(r.frames.get('p1')).toMatchObject({ origin: [0, 0, 25], normal: [0, 0, 1], xDir: [1, 0, 0], yDir: [0, 1, 0] });
    expect(volume(r)).toBeCloseTo(12000 + Math.PI * 16 * 15, 5);
    expect(dependencies(doc).parents.get('s2')).toEqual(['p1']);
  });

  it('offsets a model face and follows it when the plate gets thicker', () => {
    const features = (depth: string) => [
      ...plate(depth),
      plane('p1', { mode: 'offset', plane: face('e1:cap:end'), distance: '5' }),
      sketch('s2', onPlane('p1'), circle('k', 20, 15, 4)),
      extrude('e2', 's2', 'boss', { type: 'blind', depth: '3' }),
    ];
    const thin = regen.rebuild(build(...features('10')));
    expect(thin.frames.get('p1')!.origin[2]).toBeCloseTo(15, 9);
    expect(volume(thin)).toBeCloseTo(12000 + Math.PI * 16 * 3, 5); // a separate body floating above
    const thick = regen.rebuild(build(...features('20')));
    expect(thick.frames.get('p1')!.origin[2]).toBeCloseTo(25, 9);
    expect(dependencies(build(...features('10'))).parents.get('p1')).toEqual(['e1']);
  });

  it('suppresses sketches on a plane together with the plane', () => {
    const doc = build(...plate(), plane('p1', { mode: 'offset', plane: front, distance: '25' }), sketch('s2', onPlane('p1'), circle('k', 20, 15, 4)));
    expect(suppressionTargets(doc, 'p1', 'suppress')).toEqual(['p1', 's2']);
    // a sketch left on a suppressed plane reports why it cannot be placed
    const lone = applyCommand(doc, { type: 'setSuppressed', featureIds: ['p1'], value: true });
    expect(regen.rebuild(lone).features.at(-1)).toMatchObject({ status: 'error', message: expect.stringContaining('基準面不存在') });
  });
});

describe('angle planes', () => {
  const edge: Ref = { kind: 'edge', name: '{e1:cap:end|e1:side:s1.al1}' }; // top edge over x = 40, along y
  it.each([
    [90, 1, 0],
    [45, Math.SQRT1_2, Math.SQRT1_2],
  ])('turns the top face by %i° about the edge at x = 40', (angle, alongX, alongZ) => {
    const r = regen.rebuild(build(...plate(), plane('p1', { mode: 'angle', plane: face('e1:cap:end'), axis: edge, angle: String(angle) })));
    expect(statuses(r).at(-1)).toBe('p1=ok');
    const f = r.frames.get('p1')!;
    expect(Math.abs(f.normal[0])).toBeCloseTo(alongX, 9);
    expect(Math.abs(f.normal[2])).toBeCloseTo(alongZ, 9);
    // the plane contains the edge
    expect(dot([40 - f.origin[0], 15 - f.origin[1], 10 - f.origin[2]], f.normal)).toBeCloseTo(0, 9);
  });

  it('asks for the axis until one is picked', () => {
    const r = regen.rebuild(build(...plate(), plane('p1', { mode: 'angle', plane: face('e1:cap:end'), axis: { kind: 'edge', name: '' }, angle: '45' })));
    expect(r.features.at(-1)).toMatchObject({ status: 'error', message: '請選擇旋轉軸' });
    expect(r.features.at(-1)!.unresolved).toBeUndefined();
  });

  it('refuses an axis along the reference plane normal', () => {
    const vertical: Ref = { kind: 'edge', name: '{e1:side:s1.al0|e1:side:s1.al1}' }; // along z
    const r = regen.rebuild(build(...plate(), plane('p1', { mode: 'angle', plane: face('e1:cap:end'), axis: vertical, angle: '30' })));
    expect(r.features.at(-1)).toMatchObject({ status: 'error', message: '旋轉軸不能垂直於參考面' });
  });
});

describe('three-point planes', () => {
  const corner = (a: string, b: string) => vertex(`<e1:cap:end|e1:side:s1.${a}|e1:side:s1.${b}>`);
  it('passes through three corners of the top face and carries a pocket', () => {
    const doc = build(
      ...plate(),
      plane('p1', { mode: 'threePoint', points: [corner('al0', 'al3'), corner('al0', 'al1'), corner('al2', 'al3')] }),
      sketch('s2', onPlane('p1'), circle('k', 20, 15, 5)),
      extrude('c1', 's2', 'cut', { type: 'blind', depth: '4' }),
    );
    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 'p1=ok', 's2=ok', 'c1=ok']);
    expect(r.frames.get('p1')).toMatchObject({ origin: [0, 0, expect.closeTo(10, 9)], normal: [0, 0, 1] });
    expect(volume(r)).toBeCloseTo(12000 - Math.PI * 25 * 4, 5);
    expect(dependencies(doc).parents.get('p1')).toEqual(['e1']);
  });

  it('reports three points on a line', () => {
    // two corners of the front top edge and the vertex between them do not exist; use a corner twice
    const r = regen.rebuild(build(...plate(), plane('p1', { mode: 'threePoint', points: [corner('al0', 'al3'), corner('al0', 'al1'), corner('al0', 'al3')] })));
    expect(r.features.at(-1)).toMatchObject({ status: 'error', message: '三點共線，無法決定平面' });
  });

  it('asks for the missing points while they are being picked', () => {
    const r = regen.rebuild(build(...plate(), plane('p1', { mode: 'threePoint', points: [corner('al0', 'al3')] })));
    expect(r.features.at(-1)).toMatchObject({ status: 'error', message: '三點基準面需要三個頂點' });
  });
});

describe('plane references in the model', () => {
  it('refuses a plane on a curved face and a sketch on a plane defined later', () => {
    const doc = build(...plate(), sketch('s2', front, circle('k', 20, 15, 4)), extrude('c1', 's2', 'cut', { type: 'throughAll', reverse: true }));
    const curved = regen.rebuild(applyCommand(doc, { type: 'insertFeature', index: 4, feature: plane('p1', { mode: 'offset', plane: face('c1:side:s2.k'), distance: '2' }) }));
    expect(curved.features.at(-1)).toMatchObject({ status: 'error', message: '參考面必須是平面' });
    expect(() => applyCommand(doc, { type: 'insertFeature', index: 0, feature: sketch('s9', onPlane('p1'), circle('m', 0, 0, 1)) })).toThrow('基準面必須在它之前');
  });
});

/**
 * A coordinate system as a sketch plane (ADR 0127): the sketch takes the system's own x and y at its
 * own origin, so a system built on a reference point follows it and can be the base of a plane too.
 */
describe('coordinate system planes', () => {
  const point = (id: string, z: string): Feature => ({ id, type: 'refPoint', name: id, suppressed: false, def: { mode: 'coords', x: '0', y: '0', z } });
  /** X along the right plane's normal, Y along the top plane's: Z is up, so the plane lies flat at the origin. */
  const flat = (id: string, at: Ref): Feature => ({ id, type: 'coordSys', name: id, suppressed: false, origin: at, x: { kind: 'datum', name: 'plane:right' }, y: { kind: 'datum', name: 'plane:top' } });
  const at = (id: string): Ref => ({ kind: 'datum', name: id });
  const doc25 = () => build(...plate(), point('q1', '25'), flat('y1', at('q1')), sketch('s2', at('y1'), circle('k', 20, 15, 4)), extrude('e2', 's2', 'boss', { type: 'blind', depth: '6' }));

  it('sketches flat on a coordinate system 25 above the front plane', () => {
    const doc = doc25();
    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 'q1=ok', 'y1=ok', 's2=ok', 'e2=ok']);
    expect(r.frames.get('y1')).toMatchObject({ origin: [0, 0, 25], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] });
    expect(volume(r)).toBeCloseTo(12000 + Math.PI * 16 * 6, 5);
    expect(dependencies(doc).parents.get('s2')).toEqual(['y1']);
  });

  it('follows the point its system stands on', () => {
    const moved = applyCommand(doc25(), { type: 'setRefPoint', featureId: 'q1', def: { mode: 'coords', x: '0', y: '0', z: '30' } });
    const r = regen.rebuild(moved);
    expect(statuses(r).at(-1)).toBe('e2=ok');
    expect(r.frames.get('y1')!.origin).toEqual([0, 0, 30]);
    expect(volume(r)).toBeCloseTo(12000 + Math.PI * 16 * 6, 5);
  });

  it('is a plane a reference plane can offset from', () => {
    const doc = build(...plate(), point('q1', '25'), flat('y1', at('q1')), plane('p1', { mode: 'offset', plane: at('y1'), distance: '5' }), sketch('s2', at('p1'), circle('k', 20, 15, 4)));
    const r = regen.rebuild(doc);
    expect(statuses(r).at(-1)).toBe('s2=ok');
    expect(r.frames.get('p1')).toMatchObject({ origin: [0, 0, 30], normal: [0, 0, 1] });
    expect(dependencies(doc).parents.get('p1')).toEqual(['y1']);
  });

  it('refuses a sketch on a system defined later, and goes with the system when it is suppressed', () => {
    const doc = doc25();
    expect(() => applyCommand(doc, { type: 'insertFeature', index: 3, feature: sketch('s9', at('y1'), circle('m', 0, 0, 1)) })).toThrow('座標系統必須在它之前');
    expect(suppressionTargets(doc, 'y1', 'suppress')).toEqual(['y1', 's2', 'e2']);
    const lone = applyCommand(doc, { type: 'setSuppressed', featureIds: ['y1'], value: true });
    expect(regen.rebuild(lone).features.find((f) => f.id === 's2')).toMatchObject({ status: 'error', message: expect.stringContaining('基準面不存在') });
  });
});
