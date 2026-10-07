/**
 * 6-7 (docs/phase6-plan.md): the snap hook, its catch window and the vent (C4.11) against volumes worked out by hand — the beam and the wedge of the hook, the window of
 * a rectangle, the slots of a row (rectangles and stadiums) — and the undercut analysis finding the window of a side wall under a pull along the wall. The box is
 * 60 × 40 × 30 shelled 2 open at the top (15552 mm³); its floor is at z = 0 to 2, the side wall at x = 30 is 2 thick.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, SCHEMA_VERSION, type Feature, type PartDoc, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
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
const volume = (r: RebuildResult) => kernel.massProps(r.body!.shape).volume;
const face = (name: string): Ref => ({ kind: 'face', name });
const SHELLED = 15552;

const shell = (): Feature[] => [
  sketch('s', front, rectangle('r', -30, -20, 60, 40)),
  extrude('e', 's', 'boss', { type: 'blind', depth: '30' }),
  { id: 'sh1', type: 'shell', name: 'sh1', suppressed: false, faces: [face('e:cap:end')], thickness: '2' } as Feature,
];
/** The name of the face of the shell found by `pick` on its topology. */
function nameOf(pick: (f: { normal?: [number, number, number]; center: [number, number, number] }) => boolean): string {
  const r = rebuild(build(...shell()));
  const i = r.body!.topology.faces.findIndex((f) => pick(f as never));
  expect(i).toBeGreaterThanOrEqual(0);
  return r.body!.names.faces[i]!;
}
const floorOf = () => nameOf((f) => !!f.normal && f.normal[2] > 0.99 && Math.abs(f.center[2] - 2) < 1e-6);
const wallOutside = () => nameOf((f) => !!f.normal && f.normal[0] > 0.99 && Math.abs(f.center[0] - 30) < 1e-6);
const points = (id: string, plane: Ref, ...pts: [string, number, number][]): Feature => ({ ...sketch(id, plane), entities: pts.map(([p, x, y]) => ({ id: p, type: 'point', x, y })) }) as Feature;
const hook = (extra: Record<string, unknown> = {}): Feature => ({ id: 'h1', type: 'snapHook', name: 'h1', suppressed: false, sketch: 'sk', width: '6', thickness: '2', length: '15', hookHeight: '3', hookDepth: '1.2', ...extra }) as Feature;
const windowOf = (extra: Record<string, unknown> = {}): Feature => ({ id: 'w1', type: 'snapCatch', name: 'w1', suppressed: false, sketch: 'sk', length: '8', width: '4', depth: '3', ...extra }) as Feature;
const vent = (extra: Record<string, unknown> = {}): Feature => ({ id: 'v1', type: 'vent', name: 'v1', suppressed: false, sketch: 'sk', count: '5', pitch: '4', length: '10', width: '2', depth: '3', ...extra }) as Feature;
const bounds = (r: RebuildResult, prefix: string) => {
  const faces = r.body!.names.faces.flatMap((n, i) => (n.startsWith(prefix) ? [r.body!.topology.faces[i]!] : []));
  return faces;
};

describe('the snap hook on the inside of the floor', () => {
  let floor: string;
  const doc = (...more: Feature[]) => build(...shell(), points('sk', face(floor), ['p1', 15, 10]), ...more);
  beforeAll(() => {
    floor = floorOf();
  });

  it('a beam 2 thick, 6 wide and 15 high with a wedge 3 high standing out 1.2 at its end: 2·6·15 + ½·1.2·3·6 = 190.8 mm³ on the body, one solid, valid', () => {
    const r = rebuild(doc(hook()));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(SHELLED + 180 + 10.8, 5);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    const names = r.body!.names.faces;
    expect(new Set(names).size).toBe(names.length);
    for (const part of ['front', 'catch', 'ramp', 'tip', 'back', 'left', 'right']) expect(names).toContain(`h1:side:sk.p1.${part}`);
    // the catch face is the flat under the hook: 6 wide, 1.2 deep, at 12 above the floor (z = 2 + 12); the tip is 6 × 2 at 17
    const at = (part: string) => r.body!.topology.faces[names.indexOf(`h1:side:sk.p1.${part}`)]!;
    expect(at('catch').area).toBeCloseTo(6 * 1.2, 5);
    expect(at('catch').center[2]).toBeCloseTo(2 + 12, 6);
    expect(at('tip').area).toBeCloseTo(6 * 2, 5);
    expect(at('tip').center[2]).toBeCloseTo(2 + 15, 6);
    expect(at('ramp').area).toBeCloseTo(6 * Math.hypot(1.2, 3), 5);
    expect(at('front').area).toBeCloseTo(6 * 12, 5);
  });

  it('turned about the normal by 90°, the volume is the same and the catch face looks the other way', () => {
    const a = rebuild(doc(hook()));
    const b = rebuild(doc(hook({ angle: '90deg' })));
    expect(failures(b)).toEqual([]);
    expect(volume(b)).toBeCloseTo(volume(a), 5);
    const c = (r: RebuildResult) => r.body!.topology.faces[r.body!.names.faces.indexOf('h1:side:sk.p1.catch')]!.center;
    const ca = c(a);
    const cb = c(b);
    expect(Math.hypot(ca[0] - cb[0], ca[1] - cb[1])).toBeGreaterThan(1);
    expect(ca[2]).toBeCloseTo(cb[2], 6);
  });

  it('two points make two hooks', () => {
    const r = rebuild(build(...shell(), points('sk', face(floor), ['p1', 15, 10], ['p2', -15, -10]), hook()));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(SHELLED + 2 * 190.8, 5);
    expect(r.body!.names.faces).toContain('h1:side:sk.p2.catch');
  });

  it('follows the model: the floor 3 thick instead of 2, the hook stands 1 higher on the same volume and with the same names', () => {
    const base = rebuild(doc(hook()));
    let d = doc(hook());
    d = applyCommand(d, { type: 'setShell', featureId: 'sh1', faces: [face('e:cap:end')], thickness: '3' });
    const r = rebuild(d);
    expect(failures(r)).toEqual([]);
    expect(volume(r) - volume(rebuild(build(...shell().slice(0, 2), { ...(shell()[2] as object), thickness: '3' } as Feature)))).toBeCloseTo(190.8, 5);
    expect(r.body!.topology.faces[r.body!.names.faces.indexOf('h1:side:sk.p1.tip')]!.center[2]).toBeCloseTo(3 + 15, 6);
    expect(r.body!.names.faces.filter((n) => n.startsWith('h1:')).sort()).toEqual(base.body!.names.faces.filter((n) => n.startsWith('h1:')).sort());
  });

  it('refused: a hook as high as the beam is long, a hook standing on nothing', () => {
    const msg = (extra: Record<string, unknown>) => rebuild(doc(hook(extra))).features.find((f) => f.id === 'h1')!;
    expect(msg({ hookHeight: '15' })).toMatchObject({ status: 'error', message: expect.stringContaining('鉤高') });
    const plane = { id: 'pl', type: 'refPlane', name: 'pl', suppressed: false, def: { mode: 'offset', plane: front, distance: '100' } } as Feature;
    const r = rebuild(build(...shell(), plane, points('sk', { kind: 'datum', name: 'pl' }, ['p1', -15, 0]), hook()));
    expect(r.features.find((f) => f.id === 'h1')).toMatchObject({ status: 'error', message: expect.stringContaining('沒有接到') });
    expect(() => doc(hook({ width: '0' }))).toThrow();
  });
});

describe('the catch window in a side wall', () => {
  let outside: string;
  const doc = (...more: Feature[]) => build(...shell(), points('sk', face(outside), ['p1', -15, 0]), ...more);
  beforeAll(() => {
    outside = wallOutside();
  });
  /** Where the window is, found from its own faces. */
  const centerOf = (r: RebuildResult) => {
    const f = bounds(r, 'w1:side:sk.p1.s0.');
    expect(f.length).toBeGreaterThanOrEqual(4);
    return f;
  };

  it('a window 8 × 4 cut through the wall (3 deep into a wall of 2): 8·4·2 = 64 mm³ out of the body, four walls named by the point and the side, no floor', () => {
    const r = rebuild(doc(windowOf()));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(SHELLED - 64, 5);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    const names = r.body!.names.faces.filter((n) => n.startsWith('w1:'));
    expect(names.sort()).toEqual(['w1:side:sk.p1.s0.xhi', 'w1:side:sk.p1.s0.xlo', 'w1:side:sk.p1.s0.yhi', 'w1:side:sk.p1.s0.ylo']);
    const areas = names.map((n) => r.body!.topology.faces[r.body!.names.faces.indexOf(n)]!.area).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(4 * 2, 5);
    expect(areas[1]).toBeCloseTo(4 * 2, 5);
    expect(areas[2]).toBeCloseTo(8 * 2, 5);
    expect(areas[3]).toBeCloseTo(8 * 2, 5);
    centerOf(r);
  });

  it('a window 1 deep is a pocket 8·4·1 = 32 mm³ with a floor of its own, 8 × 4', () => {
    const r = rebuild(doc(windowOf({ depth: '1' })));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(SHELLED - 32, 5);
    const floor = r.body!.topology.faces[r.body!.names.faces.indexOf('w1:side:sk.p1.s0.floor')]!;
    expect(floor.area).toBeCloseTo(32, 5);
    expect(Math.abs(floor.center[0] - 29)).toBeLessThan(1e-6); // 1 in from the outside of the wall at x = 30
  });

  it('turned 90° the window is 4 along the old direction and 8 across: the same volume, the walls change places', () => {
    const a = rebuild(doc(windowOf()));
    const b = rebuild(doc(windowOf({ angle: '90deg' })));
    expect(failures(b)).toEqual([]);
    expect(volume(b)).toBeCloseTo(volume(a), 5);
    const area = (r: RebuildResult, part: string) => r.body!.topology.faces[r.body!.names.faces.indexOf(`w1:side:sk.p1.s0.${part}`)]!.area;
    expect(area(a, 'xhi')).toBeCloseTo(4 * 2, 5);
    expect(area(b, 'xhi')).toBeCloseTo(4 * 2, 5); // along is turned too: the end walls are always the width across
    expect(area(b, 'yhi')).toBeCloseTo(8 * 2, 5);
  });

  it('is an undercut to the analysis: pulled up the way the box opens, all four walls of the window are shut in (blocked both ways); pulled through the wall they are not, and the plain box has none', () => {
    const r = rebuild(doc(windowOf()));
    const names = r.body!.names.faces;
    const mine = (pull: [number, number, number]) => kernel.undercutAnalysis(r.body!.shape, pull).faces.filter((fc) => names[fc.face]!.startsWith('w1:'));
    const up = mine([0, 0, 1]);
    expect(up.length).toBe(4);
    expect(up.map((fc) => fc.kind)).toEqual(['undercut', 'undercut', 'undercut', 'undercut']);
    // along the wall's normal the walls of the window run along the pull: nothing is in the way, the window is a core pin of a slide
    const through = mine([1, 0, 0]);
    expect(through.length).toBe(4);
    expect(through.some((fc) => fc.kind === 'undercut')).toBe(false);
    const plain = rebuild(build(...shell()));
    expect(kernel.undercutAnalysis(plain.body!.shape, [0, 0, 1]).faces.some((fc) => fc.kind === 'undercut')).toBe(false);
  });

  it('refused: a window at a point over nothing', () => {
    const plane = { id: 'pl', type: 'refPlane', name: 'pl', suppressed: false, def: { mode: 'offset', plane: front, distance: '100' } } as Feature;
    const r = rebuild(build(...shell(), plane, points('sk', { kind: 'datum', name: 'pl' }, ['p1', -15, 0]), windowOf()));
    expect(r.features.find((f) => f.id === 'w1')).toMatchObject({ status: 'error', message: expect.stringContaining('沒有材料') });
  });
});

describe('the vent in a side wall', () => {
  let outside: string;
  const doc = (...more: Feature[]) => build(...shell(), points('sk', face(outside), ['p1', -15, 0]), ...more);
  beforeAll(() => {
    outside = wallOutside();
  });
  const SLOT = 10 * 2 * 2; // one slot through the wall of 2

  it('five slots 10 × 2 (pitch 4) through the wall: 5·10·2·2 = 200 mm³, five slots named by number, valid, one solid', () => {
    const r = rebuild(doc(vent()));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(SHELLED - 5 * SLOT, 5);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    const names = r.body!.names.faces.filter((n) => n.startsWith('v1:'));
    expect(names.length).toBe(5 * 4);
    for (const k of [0, 1, 2, 3, 4]) expect(names).toContain(`v1:side:sk.p1.s${k}.ylo`);
    expect(names.some((n) => n.includes('.s5.'))).toBe(false);
    expect(new Set(r.body!.names.faces).size).toBe(r.body!.names.faces.length);
  });

  it('the slots are 4 apart, centered on the point: the centers of the end walls of slot k are 4 apart, and the row is symmetric about the middle one', () => {
    const r = rebuild(doc(vent()));
    const mid = (k: number) => {
      const a = r.body!.topology.faces[r.body!.names.faces.indexOf(`v1:side:sk.p1.s${k}.ylo`)]!.center;
      const b = r.body!.topology.faces[r.body!.names.faces.indexOf(`v1:side:sk.p1.s${k}.yhi`)]!.center;
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] as const;
    };
    const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
    for (const k of [0, 1, 2, 3]) expect(dist(mid(k), mid(k + 1))).toBeCloseTo(4, 6);
    expect(dist(mid(0), mid(4))).toBeCloseTo(16, 6);
    // the middle slot is on the point (the wall faces are 1 in from the outside: x = 29 on average)
    expect(mid(2)[0]).toBeCloseTo(29, 6);
  });

  it('with round ends: each slot is (10 − 2)·2 + π·1² = 19.1416 mm² through 2, the ends are cylinders named xlo and xhi', () => {
    const r = rebuild(doc(vent({ rounded: true })));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(SHELLED - 5 * (8 * 2 + Math.PI) * 2, 5);
    const end = r.body!.topology.faces[r.body!.names.faces.indexOf('v1:side:sk.p1.s0.xhi')]!;
    expect(end.surface).toBe('cylinder');
    expect(end.area).toBeCloseTo(Math.PI * 1 * 2, 5);
  });

  it('one slot with a blind depth of 1 is a pocket with a floor; three slots 6 apart', () => {
    const one = rebuild(doc(vent({ count: '1', depth: '1' })));
    expect(failures(one)).toEqual([]);
    expect(volume(one)).toBeCloseTo(SHELLED - 10 * 2 * 1, 5);
    expect(one.body!.names.faces).toContain('v1:side:sk.p1.s0.floor');
    const three = rebuild(doc(vent({ count: '3', pitch: '6' })));
    expect(volume(three)).toBeCloseTo(SHELLED - 3 * SLOT, 5);
  });

  it('follows the model: the count changed from 5 to 3 takes two slots out of the names and the volume', () => {
    let d = doc(vent());
    const before = rebuild(d);
    d = applyCommand(d, { type: 'setVent', featureId: 'v1', vent: { count: '3', pitch: '4', length: '10', width: '2', depth: '3' } });
    const r = rebuild(d);
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(SHELLED - 3 * SLOT, 5);
    expect(volume(r)).toBeGreaterThan(volume(before));
    expect(r.body!.names.faces.some((n) => n.includes('.s3.'))).toBe(false);
    expect(r.body!.names.faces).toContain('v1:side:sk.p1.s2.ylo');
  });

  it('refused: 0 or 51 slots, a pitch that is not above the slot width, round ends on a slot that is not longer than it is wide', () => {
    const msg = (extra: Record<string, unknown>) => rebuild(doc(vent(extra))).features.find((f) => f.id === 'v1')!;
    expect(msg({ count: '51' })).toMatchObject({ status: 'error', message: expect.stringContaining('槽數') });
    expect(msg({ pitch: '2' })).toMatchObject({ status: 'error', message: expect.stringContaining('槽距') });
    expect(msg({ rounded: true, length: '2' })).toMatchObject({ status: 'error', message: expect.stringContaining('圓頭') });
    expect(() => doc(vent({ count: '0' }))).toThrow();
  });
});

describe('the commands and the file', () => {
  it('setSnapHook, setSnapCatch and setVent change the settings and are refused on the wrong feature; the version is 35', () => {
    const floor = floorOf();
    let d = build(...shell(), points('sk', face(floor), ['p1', 15, 10]), hook());
    d = applyCommand(d, { type: 'setSnapHook', featureId: 'h1', hook: { width: '6', thickness: '2', length: '15', hookHeight: '3', hookDepth: '1.2', angle: '45deg' } });
    expect((d.features.find((f) => f.id === 'h1') as unknown as { angle: string }).angle).toBe('45deg');
    expect(() => applyCommand(d, { type: 'setVent', featureId: 'h1', vent: { count: '3', pitch: '4', length: '10', width: '2', depth: '3' } })).toThrow();
    expect(() => applyCommand(d, { type: 'setSnapCatch', featureId: 'h1', window: { length: '8', width: '4', depth: '3' } })).toThrow();
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(35);
  });
});

describe('the window under the hook, as an option of the hook (v44)', () => {
  let floor: string;
  const doc = (...more: Feature[]) => build(...shell(), points('sk', face(floor), ['p1', 15, 10]), ...more);
  beforeAll(() => {
    floor = floorOf();
  });

  it('cuts a window in the floor in front of the beam, as far as the tip of the hook and 0.3 beyond, 0.3 beyond each side: 1.5 × 6.6 × 2 = 19.8 mm³ off 190.8 on', () => {
    const r = rebuild(doc(hook({ windowClearance: '0.3', windowDepth: '3' })));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(SHELLED + 190.8 - 19.8, 5);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    const names = r.body!.names.faces;
    expect(new Set(names).size).toBe(names.length);
    // the wall of the window at the front of the beam is flush with the front of the beam, and is one face with it
    for (const part of ['xhi', 'ylo', 'yhi']) expect(names).toContain(`h1:side:sk.p1.win.${part}`);
    expect(names).not.toContain('h1:side:sk.p1.win.xlo');
    expect(names.some((n) => n.endsWith('.win.floor'))).toBe(false); // through the floor: no bottom
    const at = (part: string) => r.body!.topology.faces[names.indexOf(`h1:side:sk.p1.win.${part}`)]!;
    expect(at('xhi').area).toBeCloseTo(6.6 * 2, 5);
    expect(at('ylo').area).toBeCloseTo(1.5 * 2, 5);
    expect(at('yhi').area).toBeCloseTo(1.5 * 2, 5);
  });

  it('with no clearance the window is exactly under the lip: 1.2 × 6 × 2 = 14.4 mm³', () => {
    const r = rebuild(doc(hook({ windowClearance: '0', windowDepth: '3' })));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(SHELLED + 190.8 - 14.4, 5);
  });

  it('a blind window is a pocket with a bottom: depth 1 in the floor of 2 is 1.5 × 6.6 × 1 = 9.9 mm³ and a floor face', () => {
    const r = rebuild(doc(hook({ windowClearance: '0.3', windowDepth: '1' })));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(SHELLED + 190.8 - 9.9, 5);
    expect(r.body!.names.faces.some((n) => n.endsWith('.win.floor'))).toBe(true);
  });

  it('is not made without the depth, and a hook with no window is as it was', () => {
    expect(volume(rebuild(doc(hook())))).toBeCloseTo(SHELLED + 190.8, 5);
  });

  it('says what is wrong: a negative clearance, a depth of 0 (refused when it is typed), a wedge too low for the tool', () => {
    const why = (extra: Record<string, unknown>, base: Feature[] = []) => statuses(rebuild(doc(...base, hook(extra)))).find((s) => s.startsWith('h1='));
    expect(why({ windowClearance: '-1', windowDepth: '3' })).toContain('間隙不可是負的');
    expect(() => doc(hook({ windowClearance: '0.3', windowDepth: '0' }))).toThrow(/大於 0/);
    expect(why({ windowClearance: '0.3', windowDepth: '3', length: '3.5', hookHeight: '3' })).toContain('鉤太貼近底面');
  });

  it('the catch face of the hook is an undercut to a mold that opens upward, and with the window under the hook it is not (the core passes from below)', () => {
    const kindOf = (r: RebuildResult) => {
      const names = r.body!.names.faces;
      const i = names.indexOf('h1:side:sk.p1.catch');
      return kernel.undercutAnalysis(r.body!.shape, [0, 0, 1]).faces.find((fc) => fc.face === i)?.kind;
    };
    expect(kindOf(rebuild(doc(hook())))).toBe('undercut');
    expect(kindOf(rebuild(doc(hook({ windowClearance: '0.3', windowDepth: '3' }))))).not.toBe('undercut');
  });

  it('the settings go through the command and are kept: the window can be taken away again', () => {
    let d = doc(hook());
    d = applyCommand(d, { type: 'setSnapHook', featureId: 'h1', hook: { width: '6', thickness: '2', length: '15', hookHeight: '3', hookDepth: '1.2', windowClearance: '0.3', windowDepth: '3' } });
    expect(d.features.find((f) => f.id === 'h1')).toMatchObject({ windowClearance: '0.3', windowDepth: '3' });
    expect(volume(rebuild(d))).toBeCloseTo(SHELLED + 190.8 - 19.8, 5);
    d = applyCommand(d, { type: 'setSnapHook', featureId: 'h1', hook: { width: '6', thickness: '2', length: '15', hookHeight: '3', hookDepth: '1.2' } });
    expect(d.features.find((f) => f.id === 'h1')).not.toHaveProperty('windowDepth');
    expect(volume(rebuild(d))).toBeCloseTo(SHELLED + 190.8, 5);
  });
});
