/**
 * ADR 0231: 「保留輪廓內」 — a cut that keeps the material inside the contour and takes away what is outside it.
 * Every volume is worked out by hand, and the ordinary cut is measured beside it so the difference is seen.
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

describe('a cut that keeps the material inside the contour (ADR 0231)', () => {
  it('leaves the column inside the contour and takes the rest away: 1000 out of 12000', () => {
    const r = rebuild(withCut({ type: 'throughAll' }, { keepInside: true }, rectangle('b', 0, 0, 10, 10)));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(10 * 10 * 10, 6);
    expect(r.bodies).toHaveLength(1);
  });

  it('is the other way round from an ordinary cut, which leaves 11000', () => {
    const ordinary = rebuild(withCut({ type: 'throughAll' }, {}, rectangle('b', 0, 0, 10, 10)));
    expect(failures(ordinary)).toEqual([]);
    expect(volume(ordinary)).toBeCloseTo(12000 - 1000, 6);
  });

  it('takes away the material inside the hole of the contour, not the ring around it', () => {
    // a 40 × 30 outer with a 10 × 10 hole: the region is the ring, so the island inside the hole is outside the contour
    const r = rebuild(withCut({ type: 'throughAll' }, { keepInside: true }, rectangle('b', 0, 0, 40, 30), rectangle('c', 10, 10, 10, 10)));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(12000 - 1000, 6);
  });

  it('keeps only what the swept region reaches: with one direction it is the column on that side of the sketch plane', () => {
    // a sketch on the plane z = 5, in the middle of the block
    const middle: Feature = { id: 'pm', type: 'refPlane', name: 'pm', suppressed: false, def: { mode: 'offset', plane: front, distance: '5' } };
    const on = (name: string): Ref => ({ kind: 'datum', name });
    const parts = [sketch('s2', on('pm'), rectangle('b', 0, 0, 10, 10))];
    const one = rebuild(build(...block(), middle, ...parts, cut('c1', 's2', { type: 'throughAll' }, { keepInside: true })));
    expect(failures(one)).toEqual([]);
    expect(volume(one)).toBeCloseTo(10 * 10 * 5, 6); // the half below the sketch plane
    const two = rebuild(
      build(...block(), middle, ...parts, cut('c1', 's2', { type: 'throughAll' }, { keepInside: true, dir2: { type: 'throughAll' } })),
    );
    expect(failures(two)).toEqual([]);
    expect(volume(two)).toBeCloseTo(10 * 10 * 10, 6); // both directions: the whole column
  });

  it('leans the kept column when the walls are drafted: 1000 + 2000t + (4000/3)t², the same part an ordinary drafted cut takes away', () => {
    const t = Math.tan(rad(3));
    // the square sits inside the block, so nothing of the drafted tool is clipped by the block
    const kept = rebuild(withCut({ type: 'throughAll' }, { keepInside: true, draft1: { angle: '3deg' } }, rectangle('b', 15, 10, 10, 10)));
    expect(failures(kept)).toEqual([]);
    expect(volume(kept)).toBeCloseTo(1000 + 2000 * t + (4000 / 3) * t * t, 6);
    const ordinary = rebuild(withCut({ type: 'throughAll' }, { draft1: { angle: '3deg' } }, rectangle('b', 15, 10, 10, 10)));
    expect(failures(ordinary)).toEqual([]);
    expect(12000 - volume(ordinary)).toBeCloseTo(volume(kept), 6);
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
    expect(volume(r)).toBeCloseTo(1000, 6);
    expect(r.features.find((f) => f.id === 'c1')?.warnings?.join(' ')).toContain('整個本體');
  });

  it('says why it did nothing: the contour holds the whole body', () => {
    const r = rebuild(withCut({ type: 'throughAll' }, { keepInside: true }, rectangle('b', 0, 0, 40, 30)));
    expect(failures(r)[0]).toContain('就是整個本體');
  });

  it('says why it took everything: there is no material inside the contour', () => {
    const r = rebuild(withCut({ type: 'throughAll' }, { keepInside: true }, rectangle('b', 50, 50, 10, 10)));
    expect(failures(r)[0]).toContain('沒有材料');
  });
});

describe('what may be asked of it (ADR 0231)', () => {
  it('takes it when the end condition is through all', () => {
    const doc = applyCommand(withCut({ type: 'throughAll' }, {}, rectangle('b', 0, 0, 10, 10)), { type: 'setKeepInside', featureId: 'c1', keepInside: true });
    const f = doc.features.find((x) => x.id === 'c1') as ExtrudeFeature;
    expect(f.keepInside).toBe(true);
  });

  it('refuses a depth: it would take away the material inside the contour beyond it', () => {
    const doc = withCut({ type: 'blind', depth: '4' }, {}, rectangle('b', 0, 0, 10, 10));
    expect(() => applyCommand(doc, { type: 'setKeepInside', featureId: 'c1', keepInside: true })).toThrow(CommandError);
    const f = doc.features.find((x) => x.id === 'c1') as ExtrudeFeature;
    expect(f.keepInside).toBeUndefined();
    expect(f.dir1).toEqual({ type: 'blind', depth: '4' }); // the document is as it was
  });

  it('refuses it on a boss: only a cut can keep what is inside the contour', () => {
    const doc = build(...block());
    expect(() => applyCommand(doc, { type: 'setKeepInside', featureId: 'e1', keepInside: true })).toThrow(CommandError);
  });

  it('refuses to change the end condition while it is on, and keeps the document as it was', () => {
    const doc = withCut({ type: 'throughAll' }, { keepInside: true }, rectangle('b', 0, 0, 10, 10));
    expect(() => applyCommand(doc, { type: 'setEndCondition', featureId: 'c1', dir: 'dir1', value: { type: 'blind', depth: '4' } })).toThrow(CommandError);
    const f = doc.features.find((x) => x.id === 'c1') as ExtrudeFeature;
    expect(f.dir1).toEqual({ type: 'throughAll' });
  });

  it('takes it away again', () => {
    const doc = applyCommand(withCut({ type: 'throughAll' }, { keepInside: true }, rectangle('b', 0, 0, 10, 10)), { type: 'setKeepInside', featureId: 'c1', keepInside: false });
    const f = doc.features.find((x) => x.id === 'c1') as ExtrudeFeature;
    expect(f.keepInside).toBeUndefined();
  });

  it('the rebuild refuses a document that carries it with a depth (the command layer is not the only door)', () => {
    const r = rebuild(withCut({ type: 'blind', depth: '4' }, { keepInside: true }, rectangle('b', 0, 0, 10, 10)));
    expect(failures(r)[0]).toContain('全部貫穿');
  });

  it('the rebuild refuses it on a boss too', () => {
    const doc = build(...block());
    const boss = { ...(doc.features.find((f) => f.id === 'e1') as ExtrudeFeature), keepInside: true } as Feature;
    const r = rebuild(applyCommand(build(...doc.features.filter((f) => f.id !== 'e1')), { type: 'insertFeature', feature: boss, index: 1 }));
    expect(failures(r)[0]).toContain('只有除料');
  });
});
