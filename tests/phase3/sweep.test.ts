/**
 * Phase 3a-6b (C4.4): the sweep. A profile carried along the path of another sketch (lines and arcs). Volumes are hand-calculated (area × length,
 * Pappus for the arcs), every face has a name of its own (`<sweep>:side:<profile sketch>.<profile edge>@<path edge>`, `cap:start`, `cap:end`), what
 * comes after finds its edges, and every way it cannot be done says why (ADR 0031).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type PartDoc, type SketchEntity, type SweepFeature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, edge, extrude, face, fillet, front, rectangle, sketch, statuses, type SketchParts } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volume = (r: RebuildResult) => r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0);

const right = { kind: 'datum', name: 'plane:right' } as const; // normal +X; its x runs along −Z, its y along Y
const point = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const line = (id: string, p1: string, p2: string): SketchEntity => ({ id, type: 'line', p1, p2 });
const arc = (id: string, center: string, start: string, end: string): SketchEntity => ({ id, type: 'arc', center, start, end });
const parts = (...entities: SketchEntity[]): SketchParts => ({ entities, constraints: [] });

/** The path of a line of 30, a quarter arc of R10 turning left, and a line of 20 up: in the XY plane from the origin. */
const bend = parts(
  point('a', 0, 0), point('b', 30, 0), point('c', 30, 10), point('d', 40, 10), point('e', 40, 30),
  line('l1', 'a', 'b'), arc('r1', 'c', 'b', 'd'), line('l2', 'd', 'e'),
);
const PATH = Math.hypot(30) + (Math.PI / 2) * 10 + 20;

const sweep = (extra: Partial<SweepFeature> = {}): Feature => ({ id: 'sw1', type: 'sweep', name: 'sw1', suppressed: false, sketch: 'sp', path: 'sq', op: 'boss', ...extra }) as Feature;
/** A profile in the plane x = 0 (local x runs along −Z, y along Y), a path in the XY plane, and the sweep. */
const make = (profile: SketchParts, path: SketchParts, extra: Partial<SweepFeature> = {}) => build(sketch('sp', right, profile), sketch('sq', front, path), sweep(extra));

describe('the sweep (C4.4)', () => {
  it('along a straight path: the prism, area × length, with a face for each edge of the profile and a cap at each end', () => {
    const r = rebuild(make(rectangle('r', -2, -3, 4, 6), parts(point('a', 0, 0), point('b', 40, 0), line('l', 'a', 'b'))));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(24 * 40, 6);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(r.body!.names.faces.slice().sort()).toEqual(['sw1:cap:end', 'sw1:cap:start', 'sw1:side:sp.rl0@l', 'sw1:side:sp.rl1@l', 'sw1:side:sp.rl2@l', 'sw1:side:sp.rl3@l']);
  });

  it('along a line, a quarter arc and a line: Pappus (a profile centred on the path), one face for each profile edge and each path edge', () => {
    const r = rebuild(make(rectangle('r', -2, -3, 4, 6), bend));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(24 * PATH, 6);
    const names = r.body!.names.faces;
    expect(names).toHaveLength(14);
    expect(new Set(names).size).toBe(14);
    expect(names).toEqual(expect.arrayContaining(['sw1:cap:start', 'sw1:cap:end', 'sw1:side:sp.rl0@l1', 'sw1:side:sp.rl0@r1', 'sw1:side:sp.rl0@l2', 'sw1:side:sp.rl3@r1']));
  });

  it('where the path turns the other way (an S) and the profile is off the path: still Pappus', () => {
    // arc A turns left about (0,10), arc B turns right about (20,10); the profile's centre is 1 to the left of the path: inside A, outside B
    const s = parts(point('a', 0, 0), point('m', 10, 10), point('n', 20, 20), point('ca', 0, 10), point('cb', 20, 10), arc('A', 'ca', 'a', 'm'), arc('B', 'cb', 'n', 'm'));
    const r = rebuild(make(rectangle('r', -2, -1, 4, 4), s));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(16 * ((Math.PI / 2) * (10 - 1) + (Math.PI / 2) * (10 + 1)), 4);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
  });

  it('a pipe: a ring profile, the outline swept less the hole swept; the inner wall has a name of its own', () => {
    const ring: SketchParts = { entities: [...circle('o', 0, 0, 3).entities, ...circle('i', 0, 0, 2).entities], constraints: [] };
    const r = rebuild(make(ring, bend));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(Math.PI * (9 - 4) * PATH, 5);
    const names = r.body!.names.faces;
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['sw1:side:sp.o@l1', 'sw1:side:sp.i@l1', 'sw1:side:sp.i@r1', 'sw1:side:sp.i@l2', 'sw1:cap:start', 'sw1:cap:end']));
  });

  it('a path drawn from its far end, or leaving against the normal of the profile, is the same sweep', () => {
    const base = volume(rebuild(make(rectangle('r', -2, -3, 4, 6), bend)));
    // the same path with its ends swapped: l2 first
    const flipped = parts(point('a', 0, 0), point('b', 30, 0), point('c', 30, 10), point('d', 40, 10), point('e', 40, 30), line('l2', 'e', 'd'), arc('r1', 'c', 'b', 'd'), line('l1', 'b', 'a'));
    const r = rebuild(make(rectangle('r', -2, -3, 4, 6), flipped));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(base, 6);
    // leaving along −X, against the normal of the profile plane
    const back = rebuild(make(rectangle('r', -2, -3, 4, 6), parts(point('a', 0, 0), point('b', -40, 0), line('l', 'a', 'b'))));
    expect(failures(back)).toEqual([]);
    expect(volume(back)).toBeCloseTo(24 * 40, 6);
    expect(kernel.isValid(back.body!.shape)).toBe(true);
  });

  it('a cut: a groove of Ø4 along a path that starts in the middle of a block, off the path\'s own plane', () => {
    const block = [sketch('s0', front, rectangle('b', -30, -15, 60, 30)), extrude('e0', 's0', 'boss', { type: 'blind', depth: '10' })];
    // the profile is a circle centred at z = 5 (local x = −5), the path runs along the bottom face z = 0
    const doc = build(...block, sketch('sp', right, circle('c', -5, 0, 2)), sketch('sq', front, parts(point('a', 0, 0), point('b', 25, 0), line('l', 'a', 'b'))), sweep({ op: 'cut' }));
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(18000 - Math.PI * 4 * 25, 6);
    expect(r.body!.names.faces).toContain('sw1:side:sp.c@l');
  });

  it('a boss on a body fuses with it; apart from it, a body of its own', () => {
    const block = [sketch('s0', front, rectangle('b', -30, -15, 60, 30)), extrude('e0', 's0', 'boss', { type: 'blind', depth: '10' })];
    const rod = (merge?: false) => build(...block, sketch('sp', right, circle('c', -5, 0, 2)), sketch('sq', front, parts(point('a', 0, 0), point('b', 40, 0), line('l', 'a', 'b'))), sweep(merge === false ? { merge: false } : {}));
    const merged = rebuild(rod());
    expect(failures(merged)).toEqual([]);
    expect(merged.bodies).toHaveLength(1);
    // the part of the rod inside the block (x from 0 to 30) is in it already: the rod adds π·4·10 beyond x = 30
    expect(volume(merged)).toBeCloseTo(18000 + Math.PI * 4 * 10, 4);
    const apart = rebuild(rod(false));
    expect(apart.bodies).toHaveLength(2);
  });

  it('two contours of the profile sketch are two solids, each with its own names', () => {
    const two = rebuild(make({ entities: [...rectangle('r', -2, -3, 4, 6).entities, ...rectangle('q', 6, -3, 3, 6).entities], constraints: [] }, parts(point('a', 0, 0), point('b', 40, 0), line('l', 'a', 'b'))));
    expect(failures(two)).toEqual([]);
    expect(volume(two)).toBeCloseTo((24 + 18) * 40, 6);
    expect(new Set(two.body!.names.faces).size).toBe(two.body!.names.faces.length);
    expect(two.body!.names.faces).toEqual(expect.arrayContaining(['sw1:side:sp.rl0@l', 'sw1:side:sp.ql0@l']));
  });

  it('what follows finds its edges: a fillet of an edge of the sweep, and a longer path keeps the names', () => {
    const swept = (len: string) => {
      const path: SketchParts = {
        entities: [point('a', 0, 0), point('b', 40, 0), line('l', 'a', 'b')],
        constraints: [{ id: 'o', type: 'coincident', a: 'a', b: '@origin' }, { id: 'h', type: 'horizontal', a: 'l' }, { id: 'len', type: 'distance', a: 'l', value: len }],
      };
      return build(sketch('sp', right, rectangle('r', -2, -3, 4, 6)), sketch('sq', front, path), sweep(), fillet('f1', [edge('{sw1:cap:end|sw1:side:sp.rl0@l}')], '1'));
    };
    const r = rebuild(swept('40'));
    expect(failures(r)).toEqual([]);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    const longer = rebuild(applyCommand(swept('40'), { type: 'setDimension', featureId: 'sq', constraintId: 'len', value: '60' }));
    expect(failures(longer)).toEqual([]);
    expect(volume(longer)).toBeGreaterThan(volume(r) + 24 * 19);
    // a face of the sweep is something to sketch on
    const on = rebuild(build(sketch('sp', right, rectangle('r', -2, -3, 4, 6)), sketch('sq', front, parts(point('a', 0, 0), point('b', 40, 0), line('l', 'a', 'b'))), sweep(), sketch('s3', face('sw1:cap:end'), circle('k', 0, 0, 1)), extrude('e3', 's3', 'boss', { type: 'blind', depth: '5' })));
    expect(failures(on)).toEqual([]);
    expect(volume(on)).toBeCloseTo(24 * 40 + Math.PI * 5, 6);
  });

  it('in a part with a fillet and a hole: the groove is cut, the references before it are still found, and a wider plate rebuilds with no failure', () => {
    const doc = build(
      sketch('s0', front, rectangle('b', -30, -15, 60, 30)),
      extrude('e0', 's0', 'boss', { type: 'blind', depth: '10' }),
      fillet('f0', [edge('{e0:cap:start|e0:side:s0.bl0}')], '1'),
      { ...sketch('sh', face('e0:cap:end')), entities: [{ id: 'hp', type: 'point', x: -20, y: 8 }] } as Feature,
      { id: 'h1', type: 'hole', name: 'h1', suppressed: false, sketch: 'sh', kind: 'straight', diameter: '6', end: { type: 'throughAll' } } as Feature,
      sketch('sp', right, circle('c', -5, 0, 2)),
      sketch('sq', front, parts(point('a', 0, 0), point('b', 25, 0), line('l', 'a', 'b'))),
      sweep({ op: 'cut' }),
      fillet('f1', [edge('{e0:cap:start|e0:side:s0.bl2}')], '1'),
    );
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    const names = r.body!.names.faces;
    expect(names).toEqual(expect.arrayContaining(['sw1:side:sp.c@l', 'sw1:cap:end', 'h1:side:sh.hp.wall']));
    expect(new Set(names).size).toBe(names.length);
    const wider = rebuild(applyCommand(doc, { type: 'setDimension', featureId: 's0', constraintId: 'bw', value: '80' }));
    expect(failures(wider)).toEqual([]);
    expect(wider.body!.names.faces).toEqual(expect.arrayContaining(['sw1:side:sp.c@l', 'h1:side:sh.hp.wall']));
  });

  it('says what is wrong with the path', () => {
    const profile = rectangle('r', -2, -3, 4, 6);
    const msg = (path: SketchParts, extra: Partial<SweepFeature> = {}) => failures(rebuild(make(profile, path, extra)))[0] ?? '';
    // no line or arc
    expect(msg(parts(point('a', 0, 0)))).toContain('路徑草圖裡沒有線或圓弧');
    // a closed run
    expect(msg(parts(point('a', 5, 0), point('b', 5, 10), point('c', 15, 10), line('l1', 'a', 'b'), line('l2', 'b', 'c'), line('l3', 'c', 'a')))).toContain('封閉的路徑');
    // two runs apart
    expect(msg(parts(point('a', 0, 0), point('b', 10, 0), point('c', 20, 5), point('d', 30, 5), line('l1', 'a', 'b'), line('l2', 'c', 'd')))).toContain('2 條分開');
    // neither end on the plane of the profile
    expect(msg(parts(point('a', 5, 0), point('b', 15, 0), line('l', 'a', 'b')))).toContain('沒有一端在輪廓所在的平面上');
    // leaving along the plane of the profile (the profile plane x = 0, the path runs up the y axis)
    expect(msg(parts(point('a', 0, 0), point('b', 0, 20), line('l', 'a', 'b')))).toContain('沿著輪廓所在的平面');
    // a path sketch that is gone
    expect(failures(rebuild(applyCommand(make(profile, bend), { type: 'setSuppressed', featureIds: ['sq'], value: true }))).find((s) => s.startsWith('sw1='))).toContain('路徑草圖');
  });

  it('says it when the profile sweeps into itself (a wide profile round a tight bend)', () => {
    // a profile 30 wide, a path that turns about a centre 3 away from the profile's middle: the near side folds over
    const tight = parts(point('a', 0, 0), point('b', 3, 3), point('c', 0, 3), arc('r', 'c', 'a', 'b'));
    const r = rebuild(make(rectangle('r', -15, -2, 30, 8), tight));
    expect(failures(r).find((s) => s.startsWith('sw1='))).toContain('不是有效的實體');
  });

  it('refuses a solid that is valid yet folded over itself: a path that turns back 158° (the profile along 20, then back 10.77) holds 240, not about 738', () => {
    const fold = parts(point('a', 0, 0), point('b', 20, 0), point('c', 10, 4), line('l1', 'a', 'b'), line('l2', 'b', 'c'));
    const r = rebuild(make(rectangle('r', -2, -3, 4, 6), fold));
    const message = failures(r).find((s) => s.startsWith('sw1=')) ?? '';
    expect(message).toContain('路徑轉折太急');
    expect(message).toContain('自己疊在一起');
  });

  it('keeps the tight bends that do not overlap: a 2 × 2 profile round a quarter arc of R5 (centred, and 1.5 off the path), where the area times the path is the volume', () => {
    const tight = parts(point('a', 0, 0), point('b', 10, 0), point('c', 10, 5), point('d', 15, 5), point('e', 15, 15), line('l1', 'a', 'b'), arc('r1', 'c', 'b', 'd'), line('l2', 'd', 'e'));
    const length = 10 + (Math.PI / 2) * 5 + 10;
    const centred = rebuild(make(rectangle('r', -1, -1, 2, 2), tight));
    expect(failures(centred)).toEqual([]);
    expect(volume(centred)).toBeCloseTo(4 * length, 5);
    const off = rebuild(make(rectangle('r', 0.5, -1, 2, 2), tight));
    expect(failures(off)).toEqual([]);
    expect(volume(off)).toBeGreaterThan(0.7 * 4 * (length - 1.5 * (Math.PI / 2)));
  });

  it('commands: the profile and the path are two sketches before the feature', () => {
    const doc = make(rectangle('r', -2, -3, 4, 6), bend);
    expect(() => applyCommand(doc, { type: 'setSweepPath', featureId: 'sw1', path: 'sp' })).toThrow('不能是同一張草圖');
    expect(() => applyCommand(doc, { type: 'setSweepPath', featureId: 'sw1', path: 'nope' })).toThrow('草圖');
    expect(() => applyCommand(doc, { type: 'setSweepPath', featureId: 'sp', path: 'sq' })).toThrow('只有掃出');
    const two = build(sketch('sp', right, rectangle('r', -2, -3, 4, 6)), sketch('sq', front, bend), sketch('sz', front, parts(point('za', 0, 0), point('zb', 10, 0), line('zl', 'za', 'zb'))), sweep());
    const moved = applyCommand(two, { type: 'setSweepPath', featureId: 'sw1', path: 'sz' });
    expect((moved.features.find((f) => f.id === 'sw1') as SweepFeature).path).toBe('sz');
    expect(volume(rebuild(moved))).toBeCloseTo(24 * 10, 6);
  });
});
