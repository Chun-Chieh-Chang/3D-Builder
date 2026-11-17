/**
 * ADR 0255: a drafted extrusion of a spline outline, read back through STEP as one drafted extrusion with the draft it was made with, and its rounds
 * where a support is the spline wall. Fixed cases; the random ones are in the fuzz files (`recognize-drafted-spline.kit.ts`). The truth is the body made
 * here.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { RECOGNIZE_TOLERANCE, RecognizeError } from '@3db/regen';
import { draftedSpline, sample, type DraftedSpline } from './recognize-drafted-spline.kit';
import { recognizeStep, XY } from './recognize-rolling-ball.kit';

const TOP = [[28.72, 25], [14, 32], [0, 25]];
let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

async function rebuilt(p: DraftedSpline) {
  const shape = draftedSpline(kernel, p);
  try {
    const r = await recognizeStep(kernel, solver, shape);
    const what = JSON.stringify(p);
    expect(r.report.volumeError, what).toBeLessThan(RECOGNIZE_TOLERANCE);
    expect(r.report.difference, what).toBeLessThan(RECOGNIZE_TOLERANCE);
    const drafts = r.doc.features.flatMap((f) => (f.type === 'extrude' && f.draft1 ? [{ angle: parseFloat(String(f.draft1.angle)), inward: !!f.draft1.inward }] : []));
    expect(drafts.length, what).toBe(1);
    expect(Math.abs(drafts[0]!.angle - Math.abs(p.draft)), what).toBeLessThan(1e-9);
    // narrowing toward the top is inward
    expect(drafts[0]!.inward, what).toBe(p.draft > 0);
    const radii = r.doc.features.flatMap((f) => (f.type === 'fillet' ? [Number(f.radius)] : [])).sort((a, b) => a - b);
    const want = [p.foot, p.top_].filter((x): x is number => x !== undefined).sort((a, b) => a - b);
    expect(radii.length, what).toBe(want.length);
    // OCCT's round is kept on these walls (the kernel's exact one has not been seen to take): a ball to 2e-5 to 1e-3 of its radius (C2)
    radii.forEach((x, i) => expect(Math.abs(x - want[i]!), what).toBeLessThan(1e-3 * want[i]!));
    return r;
  } finally {
    kernel.release(shape);
  }
}

describe('a drafted spline extrusion, read back', () => {
  it('alone and on a plate, narrowing and widening', async () => {
    for (const plate of [false, true]) for (const draft of [3, -3]) await rebuilt({ top: TOP, h: 10, draft, plate });
  }, 300_000);

  it('with a hole drafted with it (its wall a cone)', async () => {
    for (const draft of [2.5, -2.5]) await rebuilt({ top: TOP, h: 10, draft, plate: true, hole: { c: [14, 9], r: 3 } });
  }, 300_000);

  it('a wavy spline whose section a cut splits in two, and whose middle moves along the wall between sections (seeds that once failed)', async () => {
    for (const seed of [17, 18, 19, 44]) await rebuilt(sample(seed, false));
  }, 300_000);

  it('rounds seeds that once failed: a round reaching into the layer`s sections (6), caps a hair either side of 0 with a hole (13), a corner a hair off the rail`s knot (40), a section across a curvature jump (94)', async () => {
    for (const seed of [6, 13, 40, 94]) await rebuilt(sample(seed, true));
  }, 900_000);

  it('with a round between the spline wall and the plate, and another along the wall`s top edge: both supported by the spline wall', async () => {
    for (const draft of [3, -3]) {
      await rebuilt({ top: TOP, h: 10, draft, plate: true, foot: 1.2 });
      await rebuilt({ top: TOP, h: 10, draft, plate: true, foot: 1.2, top_: 0.8 });
    }
  }, 600_000);

  it('a ruled spline wall whose lean changes along it is no drafted wall: refused as freeform, not read as one', async () => {
    const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
    const outline = [L([0, 0], [28.72, 0], 'a'), L([28.72, 0], [28.72, 25], 'b'), { kind: 'spline', points: TOP, source: 'c' }, L([0, 25], [0, 0], 'd')];
    const f = (q: number[]) => [14 + 0.8 * (q[0]! - 14), 14 + 0.8 * (q[1]! - 14)];
    const scaled = outline.map((s) => (s.kind === 'spline' ? { ...s, points: (s as { points: number[][] }).points.map(f) } : { ...s, a: f((s as { a: number[] }).a), b: f((s as { b: number[] }).b) }));
    const lo = kernel.loft([{ frame: XY as never, outer: outline as never }, { frame: { ...XY, origin: [0, 0, 10] } as never, outer: scaled as never }]);
    try {
      await expect(recognizeStep(kernel, solver, lo.shape)).rejects.toThrow(RecognizeError);
      await expect(recognizeStep(kernel, solver, lo.shape)).rejects.toThrow(/自由曲面|freeform|loft|放樣/);
    } finally {
      kernel.release(lo.shape);
    }
  }, 300_000);
});
