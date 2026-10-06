/**
 * H-B (docs/help-plan.md): the worked examples in the help texts (the help.ts of each language in packages/i18n/src) are checked against the kernel, so that a number in the help
 * is a number that was calculated, and a change that moves it is seen here. The hand calculations are in the help text next to the numbers.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { holeLimits, type Feature, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, extrude, face, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const volume = (r: RebuildResult) => r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0);
const ok = (r: RebuildResult) => expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);

/** 40 × 30 × 10, the top face `e1:cap:end`. */
const block = (): Feature[] => [sketch('s1', front, rectangle('a', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' })];

/** A w × h rectangle from the axis (x = 0) out, beside a vertical centerline through the origin. */
const turned = (id: string, w: number, h: number): Feature => {
  const r = rectangle(`${id}r`, 0, 0, w, h);
  return sketch(id, front, {
    entities: [...r.entities, { id: `${id}a1`, type: 'point', x: 0, y: 0 }, { id: `${id}a2`, type: 'point', x: 0, y: h }, { id: `${id}axis`, type: 'line', p1: `${id}a1`, p2: `${id}a2`, construction: true }],
    constraints: [...r.constraints, { id: `${id}ax`, type: 'coincident', a: `${id}a1`, b: '@origin' }, { id: `${id}av`, type: 'vertical', a: `${id}axis` }],
  });
};
const revolve = (id: string, sketchId: string, op: 'boss' | 'cut', angle: string): Feature => ({ id, type: 'revolve', name: id, suppressed: false, sketch: sketchId, axis: `${sketchId}axis`, op, dir1: { type: 'blind', angle } });

describe('the worked examples in the help texts', () => {
  it('extruded cut: a 10 × 10 square cut 4 deep out of a 40 × 30 × 10 block is 11600, through all 11000', () => {
    const cut = (end: Extract<Feature, { type: 'extrude' }>['dir1']) => rebuild(build(...block(), sketch('s2', face('e1:cap:end'), rectangle('b', 0, 0, 10, 10)), extrude('c1', 's2', 'cut', end)));
    const blind = cut({ type: 'blind', depth: '4' });
    ok(blind);
    expect(volume(blind)).toBeCloseTo(12000 - 400, 6);
    const through = cut({ type: 'throughAll' });
    ok(through);
    expect(volume(through)).toBeCloseTo(12000 - 1000, 6);
  });

  it('revolve: 10 wide and 20 high on the axis is a cylinder, 6283.19, and 1570.80 for a quarter turn', () => {
    const full = rebuild(build(turned('s1', 10, 20), revolve('r1', 's1', 'boss', '360')));
    ok(full);
    expect(volume(full)).toBeCloseTo(Math.PI * 100 * 20, 5);
    expect(volume(full)).toBeCloseTo(6283.19, 2);
    const quarter = rebuild(build(turned('s1', 10, 20), revolve('r1', 's1', 'boss', '90')));
    ok(quarter);
    expect(volume(quarter)).toBeCloseTo(1570.8, 1);
  });

  it('revolved cut: a rectangle 5 wide against the axis turned out of that cylinder leaves a tube, 4712.39', () => {
    const r = rebuild(build(turned('s1', 10, 20), revolve('r1', 's1', 'boss', '360'), turned('s2', 5, 20), revolve('r2', 's2', 'cut', '360')));
    ok(r);
    expect(volume(r)).toBeCloseTo(Math.PI * (100 - 25) * 20, 5);
    expect(volume(r)).toBeCloseTo(4712.39, 2);
  });

  it('mirror: a 10 × 10 × 10 block against the right plane, mirrored with the result merged, is one solid of 2000', () => {
    const mirror: Feature = { id: 'mir1', type: 'mirror', name: 'mir1', suppressed: false, target: 'bodies', plane: { kind: 'datum', name: 'plane:right' }, seeds: [], bodies: [{ kind: 'body', name: 'e1' }] };
    const r = rebuild(build(sketch('s1', front, rectangle('a', 0, 0, 10, 10)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }), mirror));
    ok(r);
    expect(r.bodies).toHaveLength(1);
    expect(volume(r)).toBeCloseTo(2000, 6);
  });

  it('dowel hole: H7 on 6 mm is 6.000 to 6.012', () => {
    const l = holeLimits(6, 'H7');
    expect(l!.min).toBeCloseTo(6, 6);
    expect(l!.max).toBeCloseTo(6.012, 6);
  });
});
