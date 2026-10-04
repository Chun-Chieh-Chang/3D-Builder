/**
 * Phase 8-1 (hardening): the name of a face that two operands share. When a fuse joins a tool to a body and a face of the tool lies in a face of the body, the two faces become one
 * face; it has to keep the name the body's face had, so that everything made earlier (an edge picked on the plate, a fillet on the block) is still found after the join, and the
 * order the features are made in does not decide what they are called. (ADR 0085 found the other way round: the face took the name of the flange that was added.)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type Feature, type PartDoc, type Ref } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { extrude, front, rectangle, sketch, statuses } from '../phase1/builders';

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
const build = (features: Feature[]) => features.reduce((d, feature, index) => applyCommand(d, { type: 'insertFeature', feature, index }), createEmptyPart());
const volume = (r: RebuildResult) => kernel.massProps(r.body!.shape).volume;

const plate: Feature[] = [sketch('sk', front, rectangle('r', 0, 0, 120, 60)), { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' } as Feature];
function edgeAt(r: RebuildResult, mid: [number, number, number]): Ref {
  const i = r.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.hypot(e.mid[0] - mid[0], e.mid[1] - mid[1], e.mid[2] - mid[2]) < 1e-6);
  expect(i, `an edge at ${mid}`).toBeGreaterThanOrEqual(0);
  return { kind: 'edge', name: r.body!.names.edges[i]!, fingerprint: edgeFingerprint(r.body!.topology, i) };
}
let ref: { a: Ref; b: Ref; hem: Ref };
beforeAll(() => {
  const p = rebuild(build(plate));
  ref = { a: edgeAt(p, [120, 30, 1.5]), b: edgeAt(p, [60, 60, 1.5]), hem: edgeAt(p, [60, 0, 1.5]) };
});
const flangeA = (): Feature => ({ id: 'fa', type: 'edgeFlange', name: 'fa', suppressed: false, edge: ref.a, length: '40', inset: { start: '10', end: '10' }, relief: { width: '1.5', depth: '1.5' } }) as Feature;
const flangeB = (): Feature => ({ id: 'fb', type: 'edgeFlange', name: 'fb', suppressed: false, edge: ref.b, length: '25', angle: '135deg', inset: { start: '8', end: '0' }, relief: { width: '1.5', depth: '1.5' } }) as Feature;
const hem = (): Feature => ({ id: 'hm', type: 'hem', name: 'hm', suppressed: false, edge: ref.hem, length: '7', gap: '1' }) as Feature;

describe('a face that the tool and the body share keeps the body\'s name', () => {
  it('a hem the whole width of the plate: its side faces lie in the sides of the plate, which are still called what they were', () => {
    const r = rebuild(build([...plate, hem()]));
    expect(failures(r)).toEqual([]);
    const names = r.body!.names.faces;
    expect(names).toContain('bf:side:sk.rl1');
    expect(names).toContain('bf:side:sk.rl3');
    expect(names.some((n) => n.startsWith('hm:side:flange.bend.s'))).toBe(false); // the side of the bend is the plate's side, not a face of its own
  });

  it('a block with a boss on it flush with one side: the side of the block keeps its name', () => {
    const r = rebuild(build([sketch('s1', front, rectangle('a', 0, 0, 20, 20)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }), sketch('s2', front, rectangle('b', 0, 0, 10, 20)), extrude('e2', 's2', 'boss', { type: 'blind', depth: '30' })]));
    expect(failures(r)).toEqual([]);
    const names = r.body!.names.faces;
    // the side y = 0 of the block (e1) is one face with the side of the boss (e2), and it is e1's
    expect(names.filter((n) => /^e1:side:s1\./.test(n))).toHaveLength(4);
  });
});

describe('the order the flanges are made in does not decide whether they are found', () => {
  // (the golden bracket of the acceptance: the three flanges are kept apart by their insets, so that they are the same sheet in any order)
  const orders: [string, () => Feature[]][] = [
    ['hem, 135°, 90°', () => [hem(), flangeB(), flangeA()]],
    ['90°, hem, 135°', () => [flangeA(), hem(), flangeB()]],
    ['135°, 90°, hem', () => [flangeB(), flangeA(), hem()]],
  ];
  it.each(orders)('%s: every flange is made, on the edge picked on the plate', (_, features) => {
    const r = rebuild(build([...plate, ...features()]));
    expect(failures(r)).toEqual([]);
    expect(r.sheet!.flanges).toHaveLength(3);
  });

  it('the sheet is the same whatever the order — except that a flange takes the edge as it is when it is made: with the hem first the edge of the 90° flange is the 58 that is left of its 60 (the hem took 2 off the corner), so that flange is 2 narrower, by hand', () => {
    const volumes = orders.map(([, features]) => volume(rebuild(build([...plate, ...features()]))));
    expect(volumes[2]).toBeCloseTo(volumes[1]!, 4);
    const T = 1.5;
    const Ro = 3.5;
    // 2 mm less of the 90° flange: its bend and its flat piece go, the plate it cuts back is 2 more
    const perMm = (Math.PI / 2) * T * (2 + T / 2) + T * (40 - Ro) - Ro * T;
    expect(volumes[1]! - volumes[0]!).toBeCloseTo(2 * perMm, 4);
  });
});

describe('what is called what does not change when the model is changed round it', () => {
  const block = (...bosses: [string, number, number, number, number][]) => [
    sketch('s1', front, rectangle('a', 0, 0, 20, 20)),
    extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
    ...bosses.flatMap(([id, x, y, w, h]) => [sketch(`s${id}`, front, rectangle(id, x, y, w, h)), extrude(`e${id}`, `s${id}`, 'boss', { type: 'blind', depth: '30' })]),
  ];
  const namesOf = (features: Feature[], prefix: RegExp) => rebuild(build(features)).body!.names.faces.filter((n) => prefix.test(n)).sort();

  it('two bosses flush with two sides of a block: all four sides of the block keep their names, and in either order', () => {
    const b: [string, number, number, number, number] = ['b', 0, 0, 10, 20]; // flush with x = 0, y = 0 and y = 20
    const c: [string, number, number, number, number] = ['c', 0, 0, 20, 10]; // flush with x = 0, y = 0 and x = 20
    const one = namesOf(block(b, c), /^e1:/);
    const two = namesOf(block(c, b), /^e1:/);
    expect(one.filter((n) => n.startsWith('e1:side:s1.'))).toHaveLength(4);
    expect(two).toEqual(one);
  });

  it('a reference plane put in before everything changes no name — of a block with a boss, or of the bracket', () => {
    const plane = { id: 'pl', type: 'refPlane', name: 'pl', suppressed: false, def: { mode: 'offset', plane: front, distance: '5' } } as Feature;
    const features = block(['b', 0, 0, 10, 20]);
    expect(namesOf([plane, ...features], /./)).toEqual(namesOf(features, /./));
    const bracket = [...plate, flangeA(), flangeB(), hem()];
    expect(namesOf([plane, ...bracket], /./)).toEqual(namesOf(bracket, /./));
  });

  it('suppressing a flange and bringing it back gives the names it had, and the flanges after it find their edges again', () => {
    const features = [...plate, flangeA(), flangeB(), hem()];
    const before = rebuild(build(features));
    let d = build(features);
    d = applyCommand(d, { type: 'setSuppressed', featureIds: ['fb'], value: true });
    const off = rebuild(d);
    expect(off.sheet!.flanges.map((f) => f.feature)).toEqual(['fa', 'hm']); // it really was left out
    expect(failures(off)).toEqual(['fb=suppressed']);
    d = applyCommand(d, { type: 'setSuppressed', featureIds: ['fb'], value: false });
    const on = rebuild(d);
    expect(failures(on)).toEqual([]);
    expect(on.body!.names.faces.slice().sort()).toEqual(before.body!.names.faces.slice().sort());
  });
});
