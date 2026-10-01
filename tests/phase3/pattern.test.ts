/**
 * Phase 3a-7b (C6.1, C6.2): the linear and circular pattern. What the seeds added to the bodies and took from them is repeated, one copy moved to each
 * instance and joined or cut like the seed was. Volumes are hand-calculated, every face of every instance has a name of its own that does not change when
 * the count does, the seed's size drives all instances, and every way a pattern cannot be made says why (ADR 0035).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type PartDoc, type PatternDefinition, type PatternFeature, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { dependencies, Regenerator, suppressionTargets, type RebuildResult } from '@3db/regen';
import { build, circle, extrude, face, faceNamed, fillet, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volume = (r: RebuildResult) => r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0);
const messageOf = (r: RebuildResult, id: string) => r.features.find((f) => f.id === id)?.message ?? '';

const right: Ref = { kind: 'datum', name: 'plane:right' }; // normal +X
const top: Ref = { kind: 'datum', name: 'plane:top' }; // normal +Y
const datum = (id: string): Ref => ({ kind: 'datum', name: id });
const PLATE = 60 * 20 * 5;
const POST = Math.PI * 4 * 5; // radius 2, height 5

/** A plate 60 × 20 × 5 (z from 0 to 5) with a post of radius 2 and height 5 at (5, 10) on its top face. */
const plateAndPost = (): Feature[] => [
  sketch('s1', front, rectangle('p', 0, 0, 60, 20)),
  extrude('e1', 's1', 'boss', { type: 'blind', depth: '5' }),
  sketch('s2', face('e1:cap:end'), circle('k', 5, 10, 2)),
  extrude('e2', 's2', 'boss', { type: 'blind', depth: '5' }),
];
/** The same plate with a hole of radius 2 through it at (5, 10), cut from the top face. */
const plateAndHole = (): Feature[] => [
  sketch('s1', front, rectangle('p', 0, 0, 60, 20)),
  extrude('e1', 's1', 'boss', { type: 'blind', depth: '5' }),
  sketch('s2', face('e1:cap:end'), circle('k', 5, 10, 2)),
  extrude('c1', 's2', 'cut', { type: 'blind', depth: '5' }),
];
const linear = (seeds: string[], dir1: { ref?: Ref; spacing: string; count: string; reverse?: boolean }, dir2?: { ref?: Ref; spacing: string; count: string }, extra: Partial<PatternFeature> = {}): Feature => ({
  id: 'pat1',
  type: 'pattern',
  name: 'pat1',
  suppressed: false,
  seeds,
  def: { mode: 'linear', dir1: { ref: right, ...dir1 }, ...(dir2 ? { dir2: { ref: top, ...dir2 } } : {}) },
  ...extra,
});
const circular = (seeds: string[], axis: Ref, extra: Partial<Extract<PatternDefinition, { mode: 'circular' }>> = {}): Feature => ({ id: 'pat1', type: 'pattern', name: 'pat1', suppressed: false, seeds, def: { mode: 'circular', axis, count: '6', angle: '360', equal: true, ...extra } });

describe('the linear pattern (C6.1)', () => {
  it('a post five times along x, 10 apart: plate and five posts in one body, every instance with faces of its own', () => {
    const r = rebuild(build(...plateAndPost(), linear(['e2'], { spacing: '10', count: '5' })));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(PLATE + 5 * POST, 6);
    expect(r.bodies).toHaveLength(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    const names = r.body!.names.faces;
    expect(new Set(names).size).toBe(names.length);
    for (let i = 1; i <= 4; i++) {
      expect(names).toEqual(expect.arrayContaining([`pat1:inst${i}:e2:cap:end`, `pat1:inst${i}:e2:side:s2.k`]));
      // the top of instance i is 10·i further along than the seed's
      expect(faceNamed(r, `pat1:inst${i}:e2:cap:end`).center[0]).toBeCloseTo(5 + 10 * i, 6);
    }
    expect(names).toContain('e2:cap:end'); // the seed is where it was, under its own name
  });

  it('a hole five times: the plate loses five holes', () => {
    const r = rebuild(build(...plateAndHole(), linear(['c1'], { spacing: '10', count: '5' })));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(PLATE - 5 * POST, 6);
    expect(r.body!.names.faces).toEqual(expect.arrayContaining(['pat1:inst4:c1:side:s2.k']));
    expect(faceNamed(r, 'pat1:inst4:c1:side:s2.k').center[0]).toBeCloseTo(45, 6);
  });

  it('a grid of 3 by 2 posts: columns along x, rows along y, labelled by column and row', () => {
    const r = rebuild(build(...plateAndPost(), linear(['e2'], { spacing: '10', count: '3' }, { spacing: '6', count: '2' })));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(PLATE + 6 * POST, 6);
    const c = faceNamed(r, 'pat1:inst2x1:e2:cap:end').center;
    expect([c[0], c[1]]).toEqual([expect.closeTo(25, 6), expect.closeTo(16, 6)]);
    expect(r.body!.names.faces).toEqual(expect.arrayContaining(['pat1:inst1x0:e2:cap:end', 'pat1:inst0x1:e2:cap:end']));
  });

  it('turned round it goes the other way', () => {
    const r = rebuild(build(...plateAndPost(), linear(['e2'], { spacing: '2', count: '3', reverse: true }, undefined)));
    // 2 apart is less than the diameter 4: the instances run into one another, and it says so (the way round does not change that)
    expect(messageOf(r, 'pat1')).toContain('重疊');
    const ok = rebuild(build(...plateAndPost(), linear(['e2'], { spacing: '6', count: '3', reverse: true })));
    // reversed from x = 5 they fall off the plate at x < 0: the first of them does not touch the plate
    expect(ok.features.find((f) => f.id === 'pat1')?.status).toBe('error');
    expect(messageOf(ok, 'pat1')).toContain('第 2 個實例');
  });

  it('the instances to skip are left out, and the others keep their names', () => {
    const r = rebuild(build(...plateAndPost(), linear(['e2'], { spacing: '10', count: '5' }, undefined, { skip: ['2'] })));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(PLATE + 4 * POST, 6);
    expect(r.body!.names.faces.some((n) => n.startsWith('pat1:inst2:'))).toBe(false);
    expect(r.body!.names.faces).toContain('pat1:inst3:e2:cap:end');
  });

  it('the count and the spacing can be changed and the names of the instances that stay do not', () => {
    const doc = build(...plateAndPost(), linear(['e2'], { spacing: '10', count: '3' }));
    const before = rebuild(doc);
    expect(volume(before)).toBeCloseTo(PLATE + 3 * POST, 6);
    const more = applyCommand(doc, { type: 'setPattern', featureId: 'pat1', seeds: ['e2'], def: { mode: 'linear', dir1: { ref: right, spacing: '8', count: '6' } } });
    const after = rebuild(more);
    expect(failures(after)).toEqual([]);
    expect(volume(after)).toBeCloseTo(PLATE + 6 * POST, 6);
    expect(faceNamed(after, 'pat1:inst2:e2:cap:end').center[0]).toBeCloseTo(5 + 16, 6);
    expect(after.body!.names.faces).toContain('pat1:inst5:e2:cap:end');
  });

  it('the seed changes size and every instance follows: radius 2 → 3 makes five posts of radius 3', () => {
    const doc = build(...plateAndPost(), linear(['e2'], { spacing: '10', count: '5' }));
    const bigger = applyCommand(doc, { type: 'setDimension', featureId: 's2', constraintId: 'kr', value: '3' });
    const r = rebuild(bigger);
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(PLATE + 5 * Math.PI * 9 * 5, 6);
  });

  it('variables drive the spacing and the count', () => {
    let doc = build(...plateAndPost());
    doc = applyCommand(applyCommand(doc, { type: 'addVariable', variable: { id: 'v1', name: 'pitch', expr: '10' } }), { type: 'addVariable', variable: { id: 'v2', name: 'n', expr: '2' } });
    doc = applyCommand(doc, { type: 'insertFeature', index: doc.features.length, feature: linear(['e2'], { spacing: 'pitch', count: 'n + 1' }) });
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(PLATE + 3 * POST, 6);
    expect(faceNamed(r, 'pat1:inst2:e2:cap:end').center[0]).toBeCloseTo(25, 6);
    const wider = rebuild(applyCommand(applyCommand(doc, { type: 'setVariable', id: 'v1', expr: '12' }), { type: 'setVariable', id: 'v2', expr: '3' }));
    expect(failures(wider)).toEqual([]);
    expect(volume(wider)).toBeCloseTo(PLATE + 4 * POST, 6);
    expect(faceNamed(wider, 'pat1:inst3:e2:cap:end').center[0]).toBeCloseTo(41, 6);
  });

  it('a fillet on the rim of an instance finds its edge, before and after the count changes', () => {
    const rim = (i: number): Ref => ({ kind: 'edge', name: `{pat1:inst${i}:e2:cap:end|pat1:inst${i}:e2:side:s2.k}` });
    const doc = build(...plateAndPost(), linear(['e2'], { spacing: '10', count: '5' }), fillet('f1', [rim(3)], '0.5'));
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    const plain = rebuild(build(...plateAndPost(), linear(['e2'], { spacing: '10', count: '5' })));
    expect(volume(r)).toBeLessThan(volume(plain));
    const fewer = applyCommand(doc, { type: 'setPattern', featureId: 'pat1', seeds: ['e2'], def: { mode: 'linear', dir1: { ref: right, spacing: '10', count: '4' } } });
    expect(failures(rebuild(fewer))).toEqual([]);
    // an instance that is gone leaves the fillet without its edge, and it says so
    const gone = applyCommand(doc, { type: 'setPattern', featureId: 'pat1', seeds: ['e2'], def: { mode: 'linear', dir1: { ref: right, spacing: '10', count: '3' } } });
    expect(rebuild(gone).features.find((f) => f.id === 'f1')?.status).toBe('error');
  });

  it('an instance beyond the plate says which one: a cut that takes nothing, a boss that floats', () => {
    const cuts = rebuild(build(...plateAndHole(), linear(['c1'], { spacing: '10', count: '8' })));
    expect(messageOf(cuts, 'pat1')).toContain('第 6 個實例沒有碰到本體');
    const posts = rebuild(build(...plateAndPost(), linear(['e2'], { spacing: '20', count: '5' })));
    // x = 5, 25, 45, 65 (beyond the end of the plate at 60): the fourth instance is not on the plate
    expect(messageOf(posts, 'pat1')).toContain('第 3 個實例沒有接觸到本體');
    expect(volume(posts)).toBeCloseTo(PLATE + POST, 6); // the plate and the seed: the pattern gave nothing
  });

  it('instances that run into one another say so, and a count of 1 is refused', () => {
    const r = rebuild(build(...plateAndPost(), linear(['e2'], { spacing: '3', count: '4' })));
    expect(messageOf(r, 'pat1')).toBe('原始特徵與第 1 個實例互相重疊：間距小於被排列的特徵的大小，加大間距或減少實例數');
    // the command refuses what a count must not be ...
    expect(() => build(...plateAndPost(), linear(['e2'], { spacing: '10', count: '1' }))).toThrow('實例數要是 2 到 200');
    expect(() => build(...plateAndPost(), linear(['e2'], { spacing: '10', count: '2.5' }))).toThrow('實例數要是 2 到 200');
    expect(() => build(...plateAndPost(), linear(['e2'], { spacing: '10', count: '5mm' }))).toThrow('沒有單位');
    // ... and a document that has one anyway (written by hand) says so in the pattern
    const doc = build(...plateAndPost(), linear(['e2'], { spacing: '10', count: '3' }));
    const hand = { ...doc, features: doc.features.map((f) => (f.type === 'pattern' && f.def.mode === 'linear' ? { ...f, def: { ...f.def, dir1: { ...f.def.dir1, count: '1' } } } : f)) };
    expect(messageOf(rebuild(hand), 'pat1')).toContain('實例數要是 2 到');
  });

  it('the seeds must follow one another; a seed that is not there, is suppressed or failed says so', () => {
    const two = (id: string, x: number): Feature[] => [sketch(`s${id}`, face('e1:cap:end'), circle(`k${id}`, x, 10, 1)), extrude(`e${id}`, `s${id}`, 'boss', { type: 'blind', depth: '2' })];
    const apart = rebuild(build(...plateAndPost(), ...two('3', 40), ...two('4', 50), linear(['e2', 'e4'], { spacing: '10', count: '2' })));
    expect(messageOf(apart, 'pat1')).toContain('一個接著一個');
    const together = rebuild(build(...plateAndPost(), ...two('3', 20), linear(['e2', 'e3'], { spacing: '30', count: '2' })));
    expect(failures(together)).toEqual([]);
    expect(volume(together)).toBeCloseTo(PLATE + 2 * (POST + Math.PI * 2), 6);
    // the pattern follows the seed's suppression
    expect(suppressionTargets(build(...plateAndPost(), linear(['e2'], { spacing: '10', count: '2' })), 'e2', 'suppress')).toEqual(['e2', 'pat1']);
    const broken = rebuild(build(...plateAndPost(), sketch('sbad', front, { entities: [], constraints: [] }), extrude('ebad', 'sbad', 'boss', { type: 'blind', depth: '2' }), linear(['ebad'], { spacing: '10', count: '2' })));
    expect(messageOf(broken, 'pat1')).toContain('失敗');
  });

  it('a pattern of the whole of nothing — a seed that changed no material — says so', () => {
    const doc = build(...plateAndPost(), fillet('f1', [{ kind: 'edge', name: '{e1:cap:start|e1:side:s1.pal0}' }], '0.1'));
    // (an edge that does not exist makes the fillet fail, which the pattern reports as a failed seed)
    const r = rebuild({ ...doc, features: [...doc.features, { ...linear(['f1'], { spacing: '10', count: '2' }) } as Feature] });
    expect(r.features.find((f) => f.id === 'pat1')?.status).toBe('error');
  });
});

describe('patterns of other seeds', () => {
  /** A plate 60 × 20 × 5 with a counterbored hole (the hole wizard) at (5, 10) of the sketch on its top face. */
  const holed = (): Feature[] => [
    sketch('s1', front, rectangle('p', 0, 0, 60, 20)),
    extrude('e1', 's1', 'boss', { type: 'blind', depth: '5' }),
    { ...sketch('s2', face('e1:cap:end')), entities: [{ id: 'hp', type: 'point', x: 5, y: 10 }] } as Feature,
    { id: 'h1', type: 'hole', name: 'h1', suppressed: false, sketch: 's2', kind: 'counterbore', diameter: '3', cbDiameter: '6', cbDepth: '2', end: { type: 'blind', depth: '5' } } as Feature,
  ];

  it('a counterbored hole of the hole wizard, six times: its own faces repeated, each under the instance', () => {
    const one = rebuild(build(...holed()));
    const r = rebuild(build(...holed(), linear(['h1'], { spacing: '10', count: '6' })));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(PLATE - 6 * (PLATE - volume(one)), 6);
    expect(r.body!.names.faces).toEqual(expect.arrayContaining(['pat1:inst5:h1:side:s2.hp.cbwall', 'pat1:inst5:h1:side:s2.hp.wall']));
    expect(faceNamed(r, 'pat1:inst5:h1:side:s2.hp.wall').center[0]).toBeCloseTo(55, 6);
  });

  it('a boss and the fillet that rounds it together, as a run of seeds', () => {
    const rim: Ref = { kind: 'edge', name: '{e2:cap:end|e2:side:s2.k}' };
    const r = rebuild(build(...plateAndPost(), fillet('f1', [rim], '0.5'), linear(['e2', 'f1'], { spacing: '10', count: '4' })));
    expect(failures(r)).toEqual([]);
    const single = rebuild(build(...plateAndPost(), fillet('f1', [rim], '0.5')));
    const post = volume(single) - PLATE;
    expect(volume(r)).toBeCloseTo(PLATE + 4 * post, 5);
  });

  it('a boss that stands as a body of its own is repeated as bodies of their own, each named after the pattern', () => {
    // posts in the air beside the plate: one body each, since they join nothing
    const doc = build(
      sketch('s1', front, rectangle('p', 0, 0, 20, 20)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '5' }),
      sketch('s2', front, circle('k', 40, 10, 2)),
      { ...extrude('e2', 's2', 'boss', { type: 'blind', depth: '5' }), merge: false } as Feature,
      linear(['e2'], { spacing: '10', count: '3' }),
    );
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(r.bodies.map((b) => b.id)).toEqual(['e1', 'e2', 'pat1#1', 'pat1#2']);
    expect(volume(r)).toBeCloseTo(20 * 20 * 5 + 3 * POST, 6);
  });

  it('thirty instances in a good time', () => {
    const t0 = performance.now();
    const r = rebuild(build(...plateAndPost().map((f) => (f.id === 's1' ? sketch('s1', front, rectangle('p', 0, 0, 200, 20)) : f)), linear(['e2'], { spacing: '6', count: '30' })));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(200 * 20 * 5 + 30 * POST, 5);
    expect(performance.now() - t0).toBeLessThan(15000);
  });
});

describe('the circular pattern (C6.2)', () => {
  /** A plate 40 × 40 × 5 on the front plane with a post of radius 2 at (30, 20), and the axis along z through (20, 20): where the planes x = 20 and y = 20 meet. */
  const round = (): Feature[] => [
    sketch('s1', front, rectangle('p', 0, 0, 40, 40)),
    extrude('e1', 's1', 'boss', { type: 'blind', depth: '5' }),
    sketch('s2', face('e1:cap:end'), circle('k', 30, 20, 2)),
    extrude('e2', 's2', 'boss', { type: 'blind', depth: '5' }),
    { id: 'px', type: 'refPlane', name: 'px', suppressed: false, def: { mode: 'offset', plane: right, distance: '20' } },
    { id: 'py', type: 'refPlane', name: 'py', suppressed: false, def: { mode: 'offset', plane: top, distance: '20' } },
    { id: 'ax', type: 'refAxis', name: 'ax', suppressed: false, def: { mode: 'planes', plane: datum('px'), plane2: datum('py') } },
  ];

  it('six posts all the way round: 60° apart, each at 10 from the axis', () => {
    const r = rebuild(build(...round(), circular(['e2'], datum('ax'))));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(40 * 40 * 5 + 6 * POST, 6);
    for (let i = 1; i <= 5; i++) {
      const c = faceNamed(r, `pat1:inst${i}:e2:cap:end`).center;
      const a = (i * Math.PI) / 3;
      expect(c[0]).toBeCloseTo(20 + 10 * Math.cos(a), 6);
      expect(c[1]).toBeCloseTo(20 + 10 * Math.sin(a), 6);
    }
  });

  it('three posts in a quarter turn: at the seed, 45° and 90° (the last at the end of the sweep); or 30° apart', () => {
    const quarter = rebuild(build(...round(), circular(['e2'], datum('ax'), { count: '3', angle: '90' })));
    expect(failures(quarter)).toEqual([]);
    const c = faceNamed(quarter, 'pat1:inst2:e2:cap:end').center;
    expect([c[0], c[1]]).toEqual([expect.closeTo(20, 6), expect.closeTo(30, 6)]);
    const step = rebuild(build(...round(), circular(['e2'], datum('ax'), { count: '3', angle: '30', equal: false })));
    const d = faceNamed(step, 'pat1:inst2:e2:cap:end').center;
    expect(d[0]).toBeCloseTo(20 + 10 * Math.cos(Math.PI / 3), 6);
    expect(d[1]).toBeCloseTo(20 + 10 * Math.sin(Math.PI / 3), 6);
  });

  it('turned the other way round, about a cylinder face instead of an axis', () => {
    // the face of a cylinder of radius 3 standing at the middle of the plate is the axis
    const withCenter: Feature[] = [
      ...round().slice(0, 4),
      sketch('s3', face('e1:cap:end'), circle('m', 20, 20, 3)),
      extrude('e3', 's3', 'boss', { type: 'blind', depth: '5' }),
    ];
    const r = rebuild(build(...withCenter, circular(['e2'], face('e3:side:s3.m'), { reverse: true, count: '4' })));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(40 * 40 * 5 + Math.PI * 9 * 5 + 4 * POST, 6);
    const c = faceNamed(r, 'pat1:inst1:e2:cap:end').center;
    expect([c[0], c[1]]).toEqual([expect.closeTo(20, 6), expect.closeTo(10, 6)]); // turned from +x towards −y
  });

  it('a hole six times round, and the seed that is not where the axis is', () => {
    const holes: Feature[] = [
      ...round().slice(0, 2),
      sketch('s2', face('e1:cap:end'), circle('k', 30, 20, 2)),
      extrude('c1', 's2', 'cut', { type: 'blind', depth: '5' }),
      ...round().slice(4),
    ];
    const r = rebuild(build(...holes, circular(['c1'], datum('ax'))));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(40 * 40 * 5 - 6 * POST, 6);
    // a rotation axis that is not an axis
    const bad = rebuild(build(...holes, circular(['c1'], face('e1:cap:end'))));
    expect(messageOf(bad, 'pat1')).toContain('圓柱');
  });

  it('posts too close to each other overlap, and say so', () => {
    const r = rebuild(build(...round(), circular(['e2'], datum('ax'), { count: '12' })));
    // 12 posts of radius 2 at radius 10 are 5.18 apart: they do not touch; 20 would
    expect(failures(r)).toEqual([]);
    const crowded = rebuild(build(...round(), circular(['e2'], datum('ax'), { count: '20' })));
    expect(messageOf(crowded, 'pat1')).toContain('重疊');
  });
});

describe('what depends on what', () => {
  it('a pattern is the child of its seeds and of what its direction refers to; suppressing the seed suppresses it', () => {
    const doc = build(...plateAndPost(), linear(['e2'], { spacing: '10', count: '3' }));
    expect(dependencies(doc).parents.get('pat1')).toEqual(['e2']);
    const viaAxis = build(
      ...plateAndPost(),
      { id: 'ax', type: 'refAxis', name: 'ax', suppressed: false, def: { mode: 'planes', plane: right, plane2: top } },
      circular(['e2'], datum('ax')),
    );
    expect(dependencies(viaAxis).parents.get('pat1')).toEqual(['e2', 'ax']);
    expect(suppressionTargets(viaAxis, 'ax', 'suppress')).toEqual(['ax', 'pat1']);
  });

  it('the command refuses a seed that is not before it, twice, or of a kind that cannot be repeated', () => {
    const doc = build(...plateAndPost(), linear(['e2'], { spacing: '10', count: '3' }));
    expect(() => applyCommand(doc, { type: 'setPattern', featureId: 'pat1', seeds: ['pat1'], def: { mode: 'linear', dir1: { ref: right, spacing: '10', count: '3' } } })).toThrow('必須在排列之前');
    expect(() => applyCommand(doc, { type: 'setPattern', featureId: 'pat1', seeds: ['e2', 'e2'], def: { mode: 'linear', dir1: { ref: right, spacing: '10', count: '3' } } })).toThrow('不能排列兩次');
    expect(() => applyCommand(doc, { type: 'setPattern', featureId: 'pat1', seeds: ['s2'], def: { mode: 'linear', dir1: { ref: right, spacing: '10', count: '3' } } })).toThrow('不能排列');
    expect(() => applyCommand(doc, { type: 'setPattern', featureId: 'e2', seeds: ['e2'], def: { mode: 'linear', dir1: { ref: right, spacing: '10', count: '3' } } })).toThrow('只有複製排列');
    expect(() => applyCommand(doc, { type: 'setPattern', featureId: 'pat1', seeds: ['e2'], def: { mode: 'linear', dir1: { ref: { kind: 'vertex', name: 'v' }, spacing: '10', count: '3' } } })).toThrow();
  });
});
