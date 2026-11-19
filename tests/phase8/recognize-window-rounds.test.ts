/**
 * ADR 0259 slice 4b: cups with windows whose rims are rounded (`recognize-window-rounds.kit.ts`). Recognition must give one revolve, the windows' cuts and
 * the rounds as fillets, and the rebuilt solid must be the same solid. Before slice 4b every case was refused: the window path ran before the rounds were
 * read, so a round's face was taken for a window's wall.
 */
import { beforeAll, expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { RECOGNIZE_TOLERANCE } from '@3db/regen';
import { recognizeStep } from './recognize-rolling-ball.kit';
import type { MultiCup, Window } from './recognize-multi-window.kit';
import { cupWithRoundedWindows } from './recognize-window-rounds.kit';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const CUP = { r: 18.5, wall: 1, height: 18 };
const drafted = (at: number, draft = 1.5): Window => ({ kind: 'drafted', at, top: [[-3.5, 4], [0, 12], [3.5, 4]], draft });
const loft = (at: number, tilt = 20): Window => ({ kind: 'loft', at, first: [[-3, 3], [-1, 9], [1.5, 10], [3, 3]], second: [[-2.5, 3], [0, 11], [2.5, 3]], chord: 3, near: 15, far: 21, tilt });

async function check(p: MultiCup, R: number) {
  const shape = cupWithRoundedWindows(kernel, p, R);
  try {
    const r = await recognizeStep(kernel, solver, shape);
    expect(r.report.volumeError).toBeLessThan(RECOGNIZE_TOLERANCE);
    expect(r.report.difference).toBeLessThan(RECOGNIZE_TOLERANCE);
    expect(r.doc.features.filter((f) => f.type === 'revolve')).toHaveLength(1);
    expect(r.doc.features.filter((f) => f.type === 'loft')).toHaveLength(p.windows.filter((w) => w.kind === 'loft').length);
    expect(r.doc.features.some((f) => f.type === 'fillet')).toBe(true);
  } finally {
    kernel.release(shape);
  }
}

it('a drafted window with its rim rounded', async () => {
  await check({ ...CUP, windows: [drafted(0)] }, 0.5);
}, 300_000);

it('two drafted windows, rims rounded', async () => {
  await check({ ...CUP, windows: [drafted(0), drafted(180, -1)] }, 0.4);
}, 300_000);

it('a drafted and a loft window, rims rounded', async () => {
  await check({ ...CUP, windows: [drafted(0), loft(90)] }, 0.3);
}, 300_000);
