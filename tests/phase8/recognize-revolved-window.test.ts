/**
 * ADR 0259 slice 1: a body of revolution (a cup) with a window cut through its wall by a drafted spline outline (`recognize-revolved-window.kit.ts`).
 * Recognition must give one revolve and the window as cuts, and the rebuilt solid must be the same solid (volume and difference within
 * RECOGNIZE_TOLERANCE). Before ADR 0259 every case here was refused ("1 face is free-form"): the window's draft direction is no plane's normal.
 */
import { beforeAll, expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { RECOGNIZE_TOLERANCE } from '@3db/regen';
import { recognizeStep } from './recognize-rolling-ball.kit';
import { cupWithWindow } from './recognize-revolved-window.kit';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

/** The part, recognized, and the checks every case must pass. */
async function check(top: number[][], draft: number, free = true) {
  const shape = cupWithWindow(kernel, { top, draft, r: 18.5, wall: 1, height: 16 });
  try {
    // the premise: a wall with no simple surface (a drafted one is a B-spline; a straight one is a surface of extrusion)
    if (free) expect(kernel.topology(shape).faces.some((f) => f.surface === 'bsplinesurface')).toBe(true);
    const r = await recognizeStep(kernel, solver, shape);
    expect(r.report.volumeError).toBeLessThan(RECOGNIZE_TOLERANCE);
    expect(r.report.difference).toBeLessThan(RECOGNIZE_TOLERANCE);
    expect(r.doc.features.filter((f) => f.type === 'revolve')).toHaveLength(1);
    expect(r.doc.features.filter((f) => f.type === 'extrude' && f.op === 'cut').length).toBeGreaterThanOrEqual(1);
  } finally {
    kernel.release(shape);
  }
}

it('a cup with a drafted spline window (1.5°): the revolve and the window cut, the same solid', async () => {
  await check([[-4, 4], [0, 12], [4, 4]], 1.5);
}, 180_000);

it('the draft the other way (-2°)', async () => {
  await check([[-4, 4], [0, 12], [4, 4]], -2);
}, 180_000);

it('a straight wall (no draft)', async () => {
  await check([[-3.5, 3], [0, 11], [3.5, 3]], 0, false);
}, 180_000);

it('a lopsided window, 0.5° draft', async () => {
  await check([[-4, 3], [-1, 10], [1, 7], [4, 3]], 0.5);
}, 180_000);
