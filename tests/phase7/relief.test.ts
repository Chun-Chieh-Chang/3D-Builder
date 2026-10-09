/**
 * 7-4 (docs/phase7-plan.md): flanges that stop short of the ends of their edge (the inset) and the rectangular reliefs cut into the sheet beside them (C11.4), on a plate
 * 100 × 50 × 1.5 (x 0..100, y 0..50; inside radius 2, K 0.5) against volumes and positions worked out by hand. The edge on top of the x = 100 end is walked in +y with the plate on
 * its left: its start is the end at y = 0.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type PartDoc, type Ref } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { flatPattern, Regenerator, type RebuildResult } from '@3db/regen';
import { build, front, rectangle, sketch, statuses } from '../phase1/builders';

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
const T = 1.5;
const Ro = 3.5;
const base: Feature[] = [sketch('sk', front, rectangle('r', 0, 0, 100, 50)), { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' } as Feature];
const PLATE = 100 * 50 * T;
const bend = (w: number) => (Math.PI / 2) * T * w * (2 + T / 2);
const leg = (w: number) => T * w * (30 - Ro);

function edgeAt(r: RebuildResult, mid: [number, number, number]): Ref {
  const i = r.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.hypot(e.mid[0] - mid[0], e.mid[1] - mid[1], e.mid[2] - mid[2]) < 1e-6);
  expect(i, `an edge at ${mid}`).toBeGreaterThanOrEqual(0);
  return { kind: 'edge', name: r.body!.names.edges[i]!, fingerprint: edgeFingerprint(r.body!.topology, i) };
}
let topEdge: Ref;
beforeAll(() => {
  topEdge = edgeAt(rebuild(build(...base)), [100, 25, T]);
});
const flange = (extra: Record<string, unknown> = {}, edge: Ref = topEdge, id = 'ef'): Feature => ({ id, type: 'edgeFlange', name: id, suppressed: false, edge, length: '30', ...extra }) as Feature;
const make = (extra: Record<string, unknown> = {}) => rebuild(build(...base, flange(extra)));
const face = (r: RebuildResult, name: string) => r.body!.topology.faces[r.body!.names.faces.indexOf(name)]!;

describe('a flange that stops short', () => {
  it('inset 10 at the start and 5 at the end: 35 wide, y from 10 to 45 (middle 27.5), the plate cut back over those 35 only — the ears either side stay to the edge', () => {
    const r = make({ inset: { start: '10', end: '5' } });
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(PLATE - Ro * 35 * T + bend(35) + leg(35), 4);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    const out = face(r, 'ef:side:flange.flange.out');
    expect(out.center[1]).toBeCloseTo(27.5, 6);
    expect(out.area).toBeCloseTo(35 * (30 - Ro), 5);
    expect(r.sheet!.flanges[0]).toMatchObject({ width: 35, inset: [10, 5], relief: null });
    expect(r.sheet!.bends[0]!.width).toBe(35);
    expect(r.features.find((f) => f.id === 'ef')!.info).toContain('10');
  });

  it('start and end are not interchangeable: inset 5 at the start and 10 at the end puts the flange at y 5 to 40 (middle 22.5)', () => {
    const r = make({ inset: { start: '5', end: '10' } });
    expect(face(r, 'ef:side:flange.flange.out').center[1]).toBeCloseTo(22.5, 6);
  });

  it('with relief (1.5 wide, 1.5 deeper than the bend starts): a notch 1.5 × (3.5 + 1.5) × 1.5 = 11.25 mm³ beside each end, 22.5 mm³ in all', () => {
    const plain = make({ inset: { start: '10', end: '5' } });
    const r = make({ inset: { start: '10', end: '5' }, relief: { width: '1.5', depth: '1.5' } });
    expect(failures(r)).toEqual([]);
    expect(volume(plain) - volume(r)).toBeCloseTo(2 * 1.5 * (Ro + 1.5) * T, 4);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(r.sheet!.flanges[0]!.relief).toEqual({ width: 1.5, depth: 1.5, shape: 'rect' });
  });

  it('a notch is cut only where the flange stops short, and no wider than the inset: inset 1 at the start only, relief 1.5 wide → one notch 1 wide, 7.5 mm³', () => {
    const plain = make({ inset: { start: '1', end: '0' } });
    const r = make({ inset: { start: '1', end: '0' }, relief: { width: '1.5', depth: '1.5' } });
    expect(failures(r)).toEqual([]);
    expect(volume(plain) - volume(r)).toBeCloseTo(1 * (Ro + 1.5) * T, 4);
  });

  it('a relief on a flange that is the whole edge cuts nothing; without an inset the flange is what it was (the earlier numbers)', () => {
    const plain = make();
    const r = make({ relief: { width: '1.5', depth: '1.5' } });
    expect(volume(r)).toBeCloseTo(volume(plain), 6);
    expect(volume(plain)).toBeCloseTo(PLATE - Ro * 50 * T + bend(50) + leg(50), 4);
  });

  it('a hem with insets of 2 and a relief: the cut-back (2) over the 46 wide leg, the notches 1.5 × (2 + 1.5) × 1.5 each', () => {
    const hem = (extra: Record<string, unknown>) => rebuild(build(...base, { id: 'hm', type: 'hem', name: 'hm', suppressed: false, edge: topEdge, length: '10', gap: '1', ...extra } as Feature));
    const plain = hem({ inset: { start: '2', end: '2' } });
    expect(failures(plain)).toEqual([]);
    expect(volume(plain)).toBeCloseTo(PLATE - 2 * 46 * T + Math.PI * T * 46 * (0.5 + T / 2) + T * 46 * 10, 4);
    const r = hem({ inset: { start: '2', end: '2' }, relief: { width: '1.5', depth: '1.5' } });
    expect(failures(r)).toEqual([]);
    expect(volume(plain) - volume(r)).toBeCloseTo(2 * 1.5 * (2 + 1.5) * T, 4);
  });
});

describe('the shape of the relief: obround and tear (schema 50)', () => {
  const inset = { start: '10', end: '0' };
  it('an obround 4 wide and 4 deeper than the bend starts: the notch is 4 × (7.5 − 2) plus a half circle of radius 2, cut through the 1.5 thickness', () => {
    const plain = make({ inset });
    const r = make({ inset, relief: { width: '4', depth: '4', shape: 'obround' } });
    expect(failures(r)).toEqual([]);
    const area = 4 * (Ro + 4 - 2) + (Math.PI * 2 ** 2) / 2;
    expect(volume(plain) - volume(r)).toBeCloseTo(area * T, 4);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(r.sheet!.flanges[0]!.relief).toEqual({ width: 4, depth: 4, shape: 'obround' });
    // the flat pattern has the same notch: its area is smaller by the area of the notch (and its outline has the half circle)
    const flatPlain = flatPattern(kernel, plain.sheet!);
    const flat = flatPattern(kernel, r.sheet!);
    try {
      expect(flatPlain.area - flat.area).toBeCloseTo(area, 3);
      expect(flat.outline.some((seg) => seg.kind === 'arc' && Math.abs(seg.r - 2) < 1e-6)).toBe(true);
    } finally {
      kernel.release(flatPlain.shape);
      kernel.release(flat.shape);
    }
  });

  it('a tear is a slit 0.05 wide and as deep: 0.05 × (3.5 + 1.5) × 1.5; the width asked for is not used', () => {
    const plain = make({ inset: { start: '1', end: '0' } });
    const r = make({ inset: { start: '1', end: '0' }, relief: { width: '9', depth: '1.5', shape: 'tear' } });
    expect(failures(r)).toEqual([]);
    expect(volume(plain) - volume(r)).toBeCloseTo(0.05 * (Ro + 1.5) * T, 4);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(r.sheet!.flanges[0]!.relief).toMatchObject({ shape: 'tear' });
  });

  it('an obround whose depth is less than half its width does not fit and is said; a rectangle by name is the rectangle of before', () => {
    const bad = make({ inset, relief: { width: '20', depth: '1', shape: 'obround' } });
    expect(bad.features.find((f) => f.id === 'ef')).toMatchObject({ status: 'error', message: expect.stringContaining('長圓') });
    const rect = make({ inset, relief: { width: '4', depth: '4', shape: 'rect' } });
    const none = make({ inset, relief: { width: '4', depth: '4' } });
    expect(volume(rect)).toBeCloseTo(volume(none), 9);
  });
});

describe('flanges on two edges that meet at a corner, one stopping short of it', () => {
  it('the first stops 3 short at its end (y 0 to 47), the second 4 short at its start (the end at x = 100, so x 0 to 96): they do not touch — one valid solid, the corner left a small tab of the plate', () => {
    const first = make({ inset: { start: '0', end: '3' } });
    expect(failures(first)).toEqual([]);
    const next = edgeAt(first, [50, 50, T]); // the whole top edge on y = 50: the first flange left the corner alone
    const r = rebuild(build(...base, flange({ inset: { start: '0', end: '3' } }), flange({ inset: { start: '4', end: '0' } }, next, 'ef2')));
    expect(failures(r)).toEqual([]);
    const W2 = 96;
    expect(volume(r)).toBeCloseTo(PLATE - Ro * 47 * T - Ro * W2 * T + bend(47) + bend(W2) + leg(47) + leg(W2), 3);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    // the second flange ends at x = 96, half a millimetre from where the first one's bend starts (96.5)
    // (its side at x = 0 lies in the side of the plate and is the plate's face, called what it was; the end at x = 96 is one face of the bend and the flat piece, called after the bend)
    const names = r.body!.names.faces;
    expect(names).toContain('bf:side:sk.rl3');
    expect(face(r, 'ef2:side:flange.bend.s0').center[0]).toBeCloseTo(96, 6);
    expect(r.sheet!.flanges.map((f) => f.width)).toEqual([47, W2]);
  });
});

describe('what is refused', () => {
  it('insets that leave nothing of the edge; a negative inset and a relief of no size are refused where they are given', () => {
    const r = make({ inset: { start: '30', end: '20' } });
    expect(r.features.find((f) => f.id === 'ef')).toMatchObject({ status: 'error', message: expect.stringContaining('縮短') });
    expect(() => build(...base, flange({ inset: { start: '-1', end: '0' } }))).toThrow();
    expect(() => build(...base, flange({ relief: { width: '0', depth: '1' } }))).toThrow();
    expect(() => build(...base, flange({ relief: { width: '1', depth: '0' } }))).toThrow();
  });

  it('setEdgeFlange carries the insets and the relief; a notch so deep that it cuts into a bend beside it is said', () => {
    let d = build(...base, flange());
    d = applyCommand(d, { type: 'setEdgeFlange', featureId: 'ef', flange: { edge: topEdge, length: '30', inset: { start: '10', end: '5' }, relief: { width: '1.5', depth: '1.5' } } });
    expect(failures(rebuild(d))).toEqual([]);
    const deep = make({ inset: { start: '10', end: '5' }, relief: { width: '1.5', depth: '200' } });
    expect(deep.features.find((f) => f.id === 'ef')).toMatchObject({ status: 'error' });
  });
});
