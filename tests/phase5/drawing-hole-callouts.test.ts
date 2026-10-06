/**
 * D-1 (docs/drawing-callouts-plan.md): what a drawing writes of a countersunk hole (read from the shape: the diameter at the mouth and the included angle) and of a
 * tapped one (read from the feature: the model has no thread, so the callout names the thread and gives the drilled circle it really has). Every number by hand.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { viewVectors, type Dimension, type Feature, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, elementFacts, holeInfo, holeFeatures, viewFeatures } from '@3db/regen';
import { autoDimensions, evaluateDimension, holeNote, holeRows, threadedHoleText, type PlacedView } from '@3db/drawing';
import { build, extrude, face, front, rectangle, sketch } from '../phase1/builders';

const point = (id: string, x: number, y: number) => ({ id, type: 'point', x, y }) as const;
const holeSketch = (id: string, x: number, y: number): Feature => ({ ...sketch(id, face('e1:cap:end')), entities: [point(`${id}p`, x, y)] }) as Feature;
const hole = (id: string, s: string, extra: Record<string, unknown>): Feature =>
  ({ id, type: 'hole', name: id, suppressed: false, sketch: s, kind: 'straight', diameter: '8', end: { type: 'blind', depth: '10' }, ...extra }) as Feature;
const plate = (...holes: Feature[]): PartDoc => build(sketch('s1', front, rectangle('a', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }), ...holes);

let kernel: Kernel;
let solver: PlaneGcsSolver;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  regen = new Regenerator(kernel, solver);
});
afterAll(() => regen.dispose());

const top = viewVectors('front');
const placed: PlacedView = { id: 'view1', at: [200, 150], scale: 1, w: 40, h: 30, centre: [20, 15] };

/** The callout the diameter of every hole of the part comes to, in the front view, sorted. */
function callouts(doc: PartDoc, withThreads = true): string[] {
  const r = regen.rebuild(doc);
  expect(r.features.filter((f) => f.status !== 'ok').map((f) => `${f.id}: ${f.message}`)).toEqual([]);
  const body = r.body!;
  const threads = withThreads ? holeFeatures(doc) : undefined; // what the worker gives: the features of the document
  const circles = viewFeatures(body.topology, body.names, top, undefined, threads).flatMap((f) => (f.type === 'circle' && f.full && !f.convex && f.hole ? [f] : []));
  return circles
    .map((c) => {
      const facts = elementFacts(body.topology, body.names, c.ref, threads);
      const d: Dimension = { id: 'd', view: 'view1', kind: 'diameter', ref: c.ref, angle: 45, callout: true };
      const o = evaluateDimension(d, { elements: [facts as never] }, top, placed);
      return 'text' in o ? o.text : o.error;
    })
    .sort();
}

describe('a countersunk hole', () => {
  it('is read from the cone at its mouth: the diameter there and the included angle, for 82°, 90° and 100°', () => {
    for (const angle of [82, 90, 100]) {
      const doc = plate(holeSketch('s2', 20, 15), hole('h1', 's2', { kind: 'countersink', diameter: '6', csDiameter: '12', csAngle: `${angle}deg`, end: { type: 'throughAll' } }));
      const body = regen.rebuild(doc).body!;
      const infos = body.topology.faces.flatMap((f, i) => (f.geometry?.type === 'cylinder' && !f.geometry.convex ? [holeInfo(body.topology, i)] : []));
      expect(infos).toHaveLength(1);
      expect(infos[0]).toMatchObject({ through: true });
      expect(infos[0]!.countersink!.diameter).toBeCloseTo(12, 6);
      expect(Math.abs(infos[0]!.countersink!.angle - angle)).toBeLessThan(0.01);
    }
  });

  it('is written 錐孔 Ø12 90° after 貫穿, as the counterbore is written after it', () => {
    expect(holeNote({ through: true, depth: 20, countersink: { diameter: 12, angle: 90 } })).toBe('貫穿 錐孔 Ø12 90°');
    expect(holeNote({ through: false, depth: 10, countersink: { diameter: 9.5, angle: 82 } })).toBe('深 10 錐孔 Ø9.5 82°');
    expect(holeNote({ through: true, depth: 20, counterbore: { diameter: 12, depth: 4 }, countersink: { diameter: 14, angle: 90 } })).toBe('貫穿 沉頭 Ø12 深 4 錐孔 Ø14 90°');
  });

  it('is the callout of its diameter: Ø6 貫穿 錐孔 Ø12 90°', () => {
    const doc = plate(holeSketch('s2', 20, 15), hole('h1', 's2', { kind: 'countersink', diameter: '6', csDiameter: '12', csAngle: '90deg', end: { type: 'throughAll' } }));
    expect(callouts(doc)).toEqual(['Ø6 貫穿 錐孔 Ø12 90°']);
  });
});

describe('a chamfer at the mouth of a dowel hole', () => {
  const dowel = () => plate(holeSketch('s2', 20, 15), hole('h1', 's2', { kind: 'dowel', diameter: '6', fit: 'H7', chamfer: '0.5', end: { type: 'throughAll' } }));

  it('is the same cone as a countersink to the shape, and so is one to a shape with no feature behind it (an imported one)', () => {
    expect(callouts(dowel(), false)).toEqual(['Ø6 貫穿 錐孔 Ø7 90°']);
  });

  it('is not one when the feature that made the hole says it is a dowel hole: Ø6 貫穿', () => {
    expect(callouts(dowel())).toEqual(['Ø6 貫穿']);
  });
});

describe('the automatic dimensions with callouts', () => {
  it('keep apart the holes of one diameter that the callout says different things of: 2×Ø6 貫穿 and one each of the countersunk and the tapped', () => {
    const doc = plate(
      holeSketch('s2', 10, 15), hole('h1', 's2', { diameter: '6', end: { type: 'throughAll' } }),
      holeSketch('s3', 20, 15), hole('h2', 's3', { diameter: '6', end: { type: 'throughAll' } }),
      holeSketch('s4', 30, 15), hole('h3', 's4', { kind: 'countersink', diameter: '6', csDiameter: '12', csAngle: '90deg', end: { type: 'throughAll' } }),
      holeSketch('s5', 20, 5), hole('h4', 's5', { kind: 'tapped', size: 'M8', diameter: '6', end: { type: 'throughAll' } }),
    );
    const body = regen.rebuild(doc).body!;
    const features = viewFeatures(body.topology, body.names, top, undefined, holeFeatures(doc));
    const drafts = autoDimensions(features, { overall: false, holes: true, positions: false, callouts: true });
    expect(drafts.map((d) => ('count' in d ? d.count : 1)).sort()).toEqual([1, 1, 2]);
    // without callouts the diameter is all there is to tell them by: one dimension, 4×Ø6
    expect(autoDimensions(features, { overall: false, holes: true, positions: false, callouts: false }).map((d) => ('count' in d ? d.count : 1))).toEqual([4]);
  });
});

describe('a tapped hole', () => {
  const tapped = (extra: Record<string, unknown> = {}) => plate(holeSketch('s2', 20, 15), hole('h1', 's2', { kind: 'tapped', size: 'M6', diameter: '5', end: { type: 'throughAll' }, ...extra }));

  it('is found in the document by the feature that made it: M6, and a hole with a typed diameter has no size (and a plain hole is there too, as what it is)', () => {
    expect([...holeFeatures(tapped())]).toEqual([['h1', { kind: 'tapped', size: 'M6' }]]);
    expect([...holeFeatures(tapped({ size: undefined }))]).toEqual([['h1', { kind: 'tapped' }]]);
    expect([...holeFeatures(plate(holeSketch('s2', 20, 15), hole('h1', 's2', {})))]).toEqual([['h1', { kind: 'straight' }]]);
  });

  it('is found in the master model of a derived body too (the body keeps the names of its master faces)', () => {
    const master = tapped();
    const derived = { features: [{ id: 'd1', type: 'derivedBody', name: 'd1', suppressed: false, source: 'master.3dbx', body: 'e1' }] } as unknown as PartDoc;
    const sources = { get: (path: string) => (path === 'master.3dbx' ? ({ key: path, doc: master, blobs: new Map(), sources: undefined } as never) : undefined) };
    expect([...holeFeatures(derived, sources)]).toEqual([['h1', { kind: 'tapped', size: 'M6' }]]);
    expect([...holeFeatures(derived)]).toEqual([]);
  });

  it('is called by its thread, with the drilled circle the model has: M6 貫穿（底孔 Ø5）, M6 深 12（底孔 Ø5）', () => {
    expect(callouts(tapped())).toEqual(['M6 貫穿（底孔 Ø5）']);
    expect(callouts(tapped({ end: { type: 'blind', depth: '12' } }))).toEqual(['M6 深 12（底孔 Ø5）']);
  });

  it('follows the feature: M8 over a Ø6.8 drill, with no new drawing', () => {
    expect(callouts(tapped({ size: 'M8', diameter: '6.8' }))).toEqual(['M8 貫穿（底孔 Ø6.8）']);
  });

  it('has no name to give when its size was typed: 螺紋底孔 Ø5 貫穿', () => {
    expect(callouts(tapped({ size: undefined }))).toEqual(['螺紋底孔 Ø5 貫穿']);
  });

  it('is an ordinary Ø5 when nothing says it is tapped (the shape has no thread), and the other holes are as they were', () => {
    expect(callouts(tapped(), false)).toEqual(['Ø5 貫穿']);
    const mixed = plate(holeSketch('s2', 10, 15), hole('h1', 's2', { kind: 'tapped', size: 'M6', diameter: '5', end: { type: 'throughAll' } }), holeSketch('s3', 30, 15), hole('h2', 's3', { diameter: '6', end: { type: 'throughAll' } }));
    expect(callouts(mixed)).toEqual(['M6 貫穿（底孔 Ø5）', 'Ø6 貫穿']);
  });

  it('keeps the count and the parentheses of a reference dimension, and drops the tolerance (a thread has none)', () => {
    const r = regen.rebuild(tapped());
    const body = r.body!;
    const threads = holeFeatures(tapped());
    const c = viewFeatures(body.topology, body.names, top, undefined, threads).find((f) => f.type === 'circle' && f.full && f.hole)!;
    if (c.type !== 'circle') throw new Error('no circle');
    const facts = elementFacts(body.topology, body.names, c.ref, threads);
    const text = (extra: Record<string, unknown>) => {
      const o = evaluateDimension({ id: 'd', view: 'view1', kind: 'diameter', ref: c.ref, angle: 45, callout: true, ...extra } as Dimension, { elements: [facts as never] }, top, placed);
      return 'text' in o ? o.text : o.error;
    };
    expect(text({ count: 4 })).toBe('4×M6 貫穿（底孔 Ø5）');
    expect(text({ reference: true })).toBe('(M6 貫穿（底孔 Ø5）)');
    expect(text({ tolerance: { type: 'bilateral', upper: 0.1, lower: -0.1 } })).toBe('M6 貫穿（底孔 Ø5）');
    // without the callout it is the circle that is there
    expect(text({ callout: false })).toBe('Ø5');
  });

  it('is one row of the hole table, in the same words, apart from the other holes', () => {
    const doc = plate(holeSketch('s2', 10, 15), hole('h1', 's2', { kind: 'tapped', size: 'M6', diameter: '5', end: { type: 'throughAll' } }), holeSketch('s3', 30, 15), hole('h2', 's3', { diameter: '5', end: { type: 'throughAll' } }));
    const body = regen.rebuild(doc).body!;
    const rows = holeRows(viewFeatures(body.topology, body.names, top, undefined, holeFeatures(doc)));
    expect(rows.map((r) => r.size).sort()).toEqual(['M6 貫穿（底孔 Ø5）', 'Ø5 貫穿'].sort());
    expect(new Set(rows.map((r) => r.tag)).size).toBe(2); // the same drill, two kinds of hole: two groups
  });

  it('threadedHoleText says nothing of a hole that is not tapped', () => {
    expect(threadedHoleText({ through: true, depth: 20 }, 5)).toBeNull();
    expect(threadedHoleText({ through: true, depth: 20, thread: { size: 'M6' } }, 5)).toBe('M6 貫穿（底孔 Ø5）');
  });
});
