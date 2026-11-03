/**
 * ADR 0232: 「保留輪廓內」 — a cut that keeps the material inside the contour and takes away what is outside it, but only
 * within the reach of the end condition; the material beyond that reach, the other side of the sketch plane included, is
 * left as it is. Every volume is worked out by hand, and the ordinary cut is measured beside it so the difference is seen.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, CommandError, type EndCondition, type ExtrudeFeature, type Feature, type PartDoc, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, extrude, face, front, rectangle, sketch, statuses, type SketchParts } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volume = (r: RebuildResult) => r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0);
const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * The reach is cut out of the body along a face, and there the boolean leaves a sliver of the confusion tolerance
 * (1e-7 mm) over the face it meets: a few times 1e-4 mm³ on these bodies. 1e-3 mm³ is above that, and far below
 * anything the drawing would show.
 */
const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(1e-3);

/** A 40 × 30 × 10 block, from z = 0 to z = 10; the top face is `e1:cap:end`. */
const block = (): Feature[] => [sketch('s1', front, rectangle('a', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' })];

/** A cut on the given sketch, with the extra settings of the feature. */
const cut = (id: string, sketchId: string, dir1: EndCondition, extra: Partial<ExtrudeFeature> = {}): Feature => ({
  id,
  type: 'extrude',
  name: id,
  suppressed: false,
  sketch: sketchId,
  op: 'cut',
  dir1,
  ...extra,
});

/** The block with a sketch on its top face and a cut of it. */
const withCut = (dir1: EndCondition, extra: Partial<ExtrudeFeature> = {}, ...parts: SketchParts[]): PartDoc =>
  build(...block(), sketch('s2', face('e1:cap:end'), ...parts), cut('c1', 's2', dir1, extra));

/** A reference plane `distance` above the front plane. */
const plane = (id: string, distance: string): Feature => ({
  id,
  type: 'refPlane',
  name: id,
  suppressed: false,
  def: { mode: 'offset', plane: front, distance },
});
const on = (name: string): Ref => ({ kind: 'datum', name });

/** The block with a sketch on a plane at `z` and a cut of it. */
const withCutOnPlane = (z: string, dir1: EndCondition, extra: Partial<ExtrudeFeature> = {}, ...parts: SketchParts[]): PartDoc =>
  build(...block(), plane('pm', z), sketch('s2', on('pm'), ...parts), cut('c1', 's2', dir1, extra));

describe('a cut that keeps the material inside the contour (ADR 0232)', () => {
  it('leaves the column inside the contour and takes the rest away: 1000 out of 12000', () => {
    const r = rebuild(withCut({ type: 'throughAll' }, { keepInside: true }, rectangle('b', 0, 0, 10, 10)));
    expect(failures(r)).toEqual([]);
    near(volume(r), 10 * 10 * 10);
    expect(r.bodies).toHaveLength(1);
  });

  it('is the other way round from an ordinary cut, which leaves 11000', () => {
    const ordinary = rebuild(withCut({ type: 'throughAll' }, {}, rectangle('b', 0, 0, 10, 10)));
    expect(failures(ordinary)).toEqual([]);
    near(volume(ordinary), 12000 - 1000);
  });

  it('takes away the material inside the hole of the contour, not the ring around it', () => {
    // a 40 × 30 outer with a 10 × 10 hole: the region is the ring, so the island inside the hole is outside the contour
    const r = rebuild(withCut({ type: 'throughAll' }, { keepInside: true }, rectangle('b', 0, 0, 40, 30), rectangle('c', 10, 10, 10, 10)));
    expect(failures(r)).toEqual([]);
    near(volume(r), 12000 - 1000);
  });

  it('takes away only what the sweep reaches: the other side of the sketch plane is left alone', () => {
    // a sketch on the plane z = 3, in the lower part of the block; the cut reaches down through all
    const r = rebuild(withCutOnPlane('3', { type: 'throughAll' }, { keepInside: true }, rectangle('b', 0, 0, 10, 10)));
    expect(failures(r)).toEqual([]);
    // the reach is the part of the block below z = 3 (3 × 40 × 30); within it the contour wins: 3 × 10 × 10 is kept
    near(volume(r), 12000 - (3 * 40 * 30 - 3 * 10 * 10));
  });

  it('with both directions it reaches the whole block: 1000', () => {
    const r = rebuild(withCutOnPlane('3', { type: 'throughAll' }, { keepInside: true, dir2: { type: 'throughAll' } }, rectangle('b', 0, 0, 10, 10)));
    expect(failures(r)).toEqual([]);
    near(volume(r), 10 * 10 * 10);
  });

  it('leans the kept column when the walls are drafted: 1000 + 2000t + (4000/3)t², the same part an ordinary drafted cut takes away', () => {
    const t = Math.tan(rad(3));
    // the square sits inside the block, so nothing of the drafted tool is clipped by the block
    const kept = rebuild(withCut({ type: 'throughAll' }, { keepInside: true, draft1: { angle: '3deg' } }, rectangle('b', 15, 10, 10, 10)));
    expect(failures(kept)).toEqual([]);
    near(volume(kept), 1000 + 2000 * t + (4000 / 3) * t * t);
    const ordinary = rebuild(withCut({ type: 'throughAll' }, { draft1: { angle: '3deg' } }, rectangle('b', 15, 10, 10, 10)));
    expect(failures(ordinary)).toEqual([]);
    near(12000 - volume(ordinary), volume(kept));
  });

  it('takes a body that is wholly outside the contour away, and says so', () => {
    const apart: Feature = extrude('e2', 's3', 'boss', { type: 'blind', depth: '10' });
    const doc = build(
      ...block(),
      sketch('s3', front, rectangle('d', 100, 100, 10, 10)),
      apart,
      sketch('s2', face('e1:cap:end'), rectangle('b', 0, 0, 10, 10)),
      cut('c1', 's2', { type: 'throughAll' }, { keepInside: true }),
    );
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(r.bodies).toHaveLength(1);
    near(volume(r), 1000);
    expect(r.features.find((f) => f.id === 'c1')?.warnings?.join(' ')).toContain('整個本體');
  });

  it('says why it did nothing: the contour holds the whole body', () => {
    const r = rebuild(withCut({ type: 'throughAll' }, { keepInside: true }, rectangle('b', 0, 0, 40, 30)));
    expect(failures(r)[0]).toContain('都在輪廓內');
  });

  it('says why it took everything: there is no material inside the contour', () => {
    const r = rebuild(withCut({ type: 'throughAll' }, { keepInside: true }, rectangle('b', 50, 50, 10, 10)));
    expect(failures(r)[0]).toContain('沒有輪廓內的材料');
  });
});

describe('the reach it works in (ADR 0232)', () => {
  it('a depth stops where the depth stops: the block below it is left alone, 7600 of 12000', () => {
    const r = rebuild(withCut({ type: 'blind', depth: '4' }, { keepInside: true }, rectangle('b', 0, 0, 10, 10)));
    expect(failures(r)).toEqual([]);
    // the reach is the 4 mm under the top face; within it the contour wins: 4 × 10 × 10 is kept, the rest of those 4 mm is taken
    near(volume(r), 6 * 40 * 30 + 4 * 10 * 10);
  });

  it('a plane in the middle reaches to both sides of it: 9800 of 12000', () => {
    const r = rebuild(withCut({ type: 'midPlane', depth: '4' }, { keepInside: true }, rectangle('b', 0, 0, 10, 10)));
    expect(failures(r)).toEqual([]);
    // the reach is the 2 mm under the top face (the sketch is on it); the rest of the block is left alone
    near(volume(r), 8 * 40 * 30 + 2 * 10 * 10);
  });

  it('up to a face stops at that face: the material beyond it is left alone, 4300 of 12000', () => {
    const r = rebuild(withCutOnPlane('3', { type: 'upToFace', face: face('e1:cap:end'), reverse: true }, { keepInside: true }, rectangle('b', 0, 0, 10, 10)));
    expect(failures(r)).toEqual([]);
    // the reach is from the plane z = 3 up to the top face (7 mm); within it the contour wins
    near(volume(r), 3 * 40 * 30 + 7 * 10 * 10);
  });

  it('a draft leans the contour within the reach: the taper keeps what is inside it', () => {
    const t = Math.tan(rad(3));
    const r = rebuild(
      withCut({ type: 'blind', depth: '4' }, { keepInside: true, draft1: { angle: '3deg', inward: true } }, rectangle('b', 10, 5, 20, 20)),
    );
    expect(failures(r)).toEqual([]);
    // the reach is the 4 mm under the top face; within it the tapered contour wins: a frustum 20 × 20 at the top, 20 − 8t wide at the bottom
    const frustum = (4 / 3) * (400 + (20 - 8 * t) ** 2 + 20 * (20 - 8 * t));
    near(volume(r), 6 * 40 * 30 + frustum);
  });
});

describe('what may be asked of it (ADR 0232)', () => {
  it('takes it when the end condition is through all', () => {
    const doc = applyCommand(withCut({ type: 'throughAll' }, {}, rectangle('b', 0, 0, 10, 10)), { type: 'setKeepInside', featureId: 'c1', keepInside: true });
    const f = doc.features.find((x) => x.id === 'c1') as ExtrudeFeature;
    expect(f.keepInside).toBe(true);
  });

  it('takes it with a depth as well: the reach is the depth', () => {
    const doc = applyCommand(withCut({ type: 'blind', depth: '4' }, {}, rectangle('b', 0, 0, 10, 10)), { type: 'setKeepInside', featureId: 'c1', keepInside: true });
    const f = doc.features.find((x) => x.id === 'c1') as ExtrudeFeature;
    expect(f.keepInside).toBe(true);
    expect(f.dir1).toEqual({ type: 'blind', depth: '4' });
  });

  it('refuses it on a boss: only a cut can keep what is inside the contour', () => {
    const doc = build(...block());
    expect(() => applyCommand(doc, { type: 'setKeepInside', featureId: 'e1', keepInside: true })).toThrow(CommandError);
  });

  it('lets the end condition be changed while it is on', () => {
    const doc = withCut({ type: 'throughAll' }, { keepInside: true }, rectangle('b', 0, 0, 10, 10));
    const next = applyCommand(doc, { type: 'setEndCondition', featureId: 'c1', dir: 'dir1', value: { type: 'blind', depth: '4' } });
    const f = next.features.find((x) => x.id === 'c1') as ExtrudeFeature;
    expect(f.dir1).toEqual({ type: 'blind', depth: '4' });
    expect(f.keepInside).toBe(true);
    // and the rebuild takes it
    const r = rebuild(next);
    expect(failures(r)).toEqual([]);
    near(volume(r), 7600);
  });

  it('takes it away again', () => {
    const doc = applyCommand(withCut({ type: 'throughAll' }, { keepInside: true }, rectangle('b', 0, 0, 10, 10)), { type: 'setKeepInside', featureId: 'c1', keepInside: false });
    const f = doc.features.find((x) => x.id === 'c1') as ExtrudeFeature;
    expect(f.keepInside).toBeUndefined();
  });

  it('the rebuild refuses it on a boss too (the command layer is not the only door)', () => {
    const doc = build(...block());
    const boss = { ...(doc.features.find((f) => f.id === 'e1') as ExtrudeFeature), keepInside: true } as Feature;
    const r = rebuild(applyCommand(build(...doc.features.filter((f) => f.id !== 'e1')), { type: 'insertFeature', feature: boss, index: 1 }));
    expect(failures(r)[0]).toContain('只有除料');
  });
});

describe('its shapes (ADR 0232)', () => {
  it('are not leaked by rebuilds: the stretch and the tool are let go', () => {
    const doc = withCut({ type: 'throughAll' }, { keepInside: true }, rectangle('b', 0, 0, 10, 10));
    const regen = new Regenerator(kernel, solver, new Map());
    regen.rebuild(doc);
    const live = kernel.liveShapes;
    for (let n = 0; n < 5; n++) regen.rebuild(doc);
    expect(kernel.liveShapes).toBe(live);
    regen.dispose();
  });
});
