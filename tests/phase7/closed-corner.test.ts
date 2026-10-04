/**
 * Hardening H-6 (the closed corner of C11.4): two flanges of 90° on neighbouring edges of a plate 100 × 60 × 1.5 (inside radius 2, K 0.5). The first, on the x = 100 end, takes the whole
 * width (its inside is the plane x = 98.5). The second, on the y = 60 edge (96.5 long when the first has been made), keeps its bend 0.5 clear of the first one's (an inset of 0.5, so
 * its bend ends at x = 96), and with a closed corner of gap 0.5 its flat piece goes on to x = 98, 0.5 from the inside of the first: 2.0 longer than the bend, by hand.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type Feature, type PartDoc, type Ref } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { flatPattern, Regenerator, type RebuildResult } from '@3db/regen';
import { front, rectangle, sketch, statuses } from '../phase1/builders';

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
const build = (features: Feature[]): PartDoc => features.reduce((d, feature, index) => applyCommand(d, { type: 'insertFeature', feature, index }), createEmptyPart());
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const T = 1.5;
const Ro = 3.5;
const plate: Feature[] = [sketch('sk', front, rectangle('r', 0, 0, 100, 60)), { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' } as Feature];
const bend = (w: number) => (Math.PI / 2) * T * w * (2 + T / 2);
const BA = (Math.PI / 2) * 2.75;

function edgeAt(r: RebuildResult, mid: [number, number, number]): Ref {
  const i = r.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.hypot(e.mid[0] - mid[0], e.mid[1] - mid[1], e.mid[2] - mid[2]) < 1e-6);
  expect(i, `an edge at ${mid}`).toBeGreaterThanOrEqual(0);
  return { kind: 'edge', name: r.body!.names.edges[i]!, fingerprint: edgeFingerprint(r.body!.topology, i) };
}
let edgeA: Ref;
let edgeB: Ref; // the top edge on y = 60, as it is when the first flange has been made
beforeAll(() => {
  edgeA = edgeAt(rebuild(build(plate)), [100, 30, T]);
  const withA = rebuild(build([...plate, flangeA()]));
  edgeB = edgeAt(withA, [48.25, 60, T]);
});
const flangeA = (): Feature => ({ id: 'fa', type: 'edgeFlange', name: 'fa', suppressed: false, edge: edgeA, length: '40' }) as Feature;
const flangeB = (extra: Record<string, unknown> = {}): Feature => ({ id: 'fb', type: 'edgeFlange', name: 'fb', suppressed: false, edge: edgeB, length: '30', inset: { start: '0.5', end: '0' }, ...extra }) as Feature;
const make = (extra: Record<string, unknown> = {}) => rebuild(build([...plate, flangeA(), flangeB(extra)]));
const volume = (r: RebuildResult) => kernel.massProps(r.body!.shape).volume;

describe('a closed corner', () => {
  const open = () => make();
  const closed = (gap = '0.5') => make({ corner: { start: gap } });

  it('the flat piece of the second flange goes on 2.0 past its bend, to 0.5 from the inside of the first: 2.0 × (30 − 3.5) × 1.5 = 79.5 mm³ more than an open corner, one valid solid that does not touch the first flange', () => {
    const o = open();
    const c = closed();
    expect(failures(o)).toEqual([]);
    expect(failures(c)).toEqual([]);
    expect(volume(c) - volume(o)).toBeCloseTo(2.0 * (30 - Ro) * T, 4);
    expect(volume(c)).toBeCloseTo(100 * 60 * T - Ro * 60 * T + bend(60) + T * 60 * 36.5 - Ro * 96 * T + bend(96) + T * 98 * 26.5, 4);
    expect(kernel.solidCount(c.body!.shape)).toBe(1);
    expect(kernel.isValid(c.body!.shape)).toBe(true);
    // the end of the flat piece: a face square to x at x = 98, 1.5 × 26.5
    const ends = c.body!.topology.faces.filter((f) => f.normal && f.normal[0] > 0.99 && Math.abs(f.center[0] - 98) < 1e-6);
    expect(ends).toHaveLength(1);
    expect(ends[0]!.area).toBeCloseTo(T * 26.5, 5);
    expect(c.sheet!.flanges[1]!.corner).toEqual([expect.closeTo(2, 9), 0]);
    expect(c.sheet!.flanges[1]!.width).toBeCloseTo(96, 9); // the bend is the 96 it was
  });

  it('a gap of 0.2 leaves 0.2: the piece is 2.3 longer; and the gap asked for is what is left', () => {
    const c = closed('0.2');
    expect(failures(c)).toEqual([]);
    expect(c.sheet!.flanges[1]!.corner[0]).toBeCloseTo(2.3, 9);
    expect(volume(c) - volume(open())).toBeCloseTo(2.3 * (30 - Ro) * T, 4);
  });

  it('the flat pattern has the wider piece: 2.0 × 26.5 = 53 mm² more, the size the same, and at K 0.5 the volume of the folded sheet', () => {
    const o = open();
    const c = closed();
    const [po, pc] = [o, c].map((r) => {
      const p = flatPattern(kernel, r.sheet!);
      kernel.release(p.shape);
      return p;
    }) as [ReturnType<typeof flatPattern>, ReturnType<typeof flatPattern>];
    expect(pc.area - po.area).toBeCloseTo(2.0 * 26.5, 4);
    expect(pc.width).toBeCloseTo(po.width, 6);
    expect(pc.height).toBeCloseTo(po.height, 6);
    expect(pc.volume).toBeCloseTo(volume(c), 3);
    expect(pc.width).toBeCloseTo(100 - Ro + BA + 36.5, 4);
    expect(pc.height).toBeCloseTo(60 - Ro + BA + 26.5, 4);
  });

  it('the closed corner is said where it cannot be made: no flange to close against at that end, a gap bigger than the way there', () => {
    const none = make({ corner: { end: '0.5' } });
    expect(none.features.find((f) => f.id === 'fb')).toMatchObject({ status: 'error', message: expect.stringContaining('閉合角落') });
    const far = make({ corner: { start: '3' } });
    expect(far.features.find((f) => f.id === 'fb')).toMatchObject({ status: 'error', message: expect.stringContaining('2.500') });
    // the first flange made later has nothing next to it yet
    const first = rebuild(build([...plate, { ...flangeA(), corner: { start: '0.5', end: '0.5' } } as Feature]));
    expect(first.features.find((f) => f.id === 'fa')).toMatchObject({ status: 'error', message: expect.stringContaining('閉合角落') });
  });

  it('follows the model: the plate 140 long moves the first flange, and the corner is still closed 0.5 from it', () => {
    const wide: Feature[] = [sketch('sk', front, rectangle('r', 0, 0, 140, 60)), plate[1]!];
    const e = rebuild(build(wide));
    const a = { ...flangeA(), edge: edgeAt(e, [140, 30, T]) } as Feature;
    const withA = rebuild(build([...wide, a]));
    const b = { ...flangeB({ corner: { start: '0.5' } }), edge: edgeAt(withA, [(140 - Ro) / 2, 60, T]) } as Feature;
    const r = rebuild(build([...wide, a, b]));
    expect(failures(r)).toEqual([]);
    expect(r.sheet!.flanges[1]!.corner[0]).toBeCloseTo(2, 9);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
  });

  it('setEdgeFlange carries the corner; a gap below 0 is refused where it is given', () => {
    let d = build([...plate, flangeA(), flangeB()]);
    d = applyCommand(d, { type: 'setEdgeFlange', featureId: 'fb', flange: { edge: edgeB, length: '30', inset: { start: '0.5', end: '0' }, corner: { start: '0.5' } } });
    expect(failures(rebuild(d))).toEqual([]);
    expect(() => build([...plate, flangeA(), flangeB({ corner: { start: '-1' } })])).toThrow();
  });
});
