/**
 * ADR 0259 slice 4a: a cup with several windows (`recognize-multi-window.kit.ts`). Recognition must give one revolve and the windows' cuts (a drafted
 * window up and down from its curve's plane, a loft one as one loft), and the rebuilt solid must be the same solid. Before slice 4a every case was
 * refused: the window path took one window only.
 */
import { beforeAll, expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { RECOGNIZE_TOLERANCE } from '@3db/regen';
import { recognizeStep } from './recognize-rolling-ball.kit';
import { cupWithWindows, type MultiCup, type Window } from './recognize-multi-window.kit';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const CUP = { r: 18.5, wall: 1, height: 18 };
const drafted = (at: number, draft = 1.5): Window => ({ kind: 'drafted', at, top: [[-3.5, 4], [0, 12], [3.5, 4]], draft });
const loft = (at: number, tilt = 20): Window => ({ kind: 'loft', at, first: [[-3, 3], [-1, 9], [1.5, 10], [3, 3]], second: [[-2.5, 3], [0, 11], [2.5, 3]], chord: 3, near: 15, far: 21, tilt });

async function check(p: MultiCup) {
  const shape = cupWithWindows(kernel, p);
  try {
    const r = await recognizeStep(kernel, solver, shape);
    expect(r.report.volumeError).toBeLessThan(RECOGNIZE_TOLERANCE);
    expect(r.report.difference).toBeLessThan(RECOGNIZE_TOLERANCE);
    expect(r.doc.features.filter((f) => f.type === 'revolve')).toHaveLength(1);
    expect(r.doc.features.filter((f) => f.type === 'loft')).toHaveLength(p.windows.filter((w) => w.kind === 'loft').length);
    const cuts = r.doc.features.filter((f) => f.type === 'extrude' && f.op === 'cut').length;
    // a drafted window is one or two extrude cuts (up and down from its curve's plane)
    const n = p.windows.filter((w) => w.kind === 'drafted').length;
    expect(cuts).toBeGreaterThanOrEqual(n);
    expect(cuts).toBeLessThanOrEqual(2 * n);
  } finally {
    kernel.release(shape);
  }
}

it('two drafted windows opposite each other', async () => {
  await check({ ...CUP, windows: [drafted(0), drafted(180, -1)] });
}, 300_000);

it("windows at ±x and ±z (part-3's layout: no half-plane along a default direction is clear)", async () => {
  await check({ ...CUP, windows: [drafted(0), drafted(180), loft(90), loft(270, -15)] });
}, 300_000);

it('a drafted, a straight and a loft window', async () => {
  await check({ ...CUP, windows: [drafted(0), drafted(270, 0), loft(90)] });
}, 300_000);

