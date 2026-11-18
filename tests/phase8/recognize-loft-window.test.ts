/**
 * ADR 0259 slice 2: a cup with a window cut by a ruled loft between sections on two planes that are not parallel (`recognize-loft-window.kit.ts`), as
 * part-3's A windows are. Recognition must give one revolve and the window as one loft cut, and the rebuilt solid must be the same solid (volume and
 * difference within RECOGNIZE_TOLERANCE). Before slice 2 every case here was refused: the wall is no drafted or straight wall along any direction.
 */
import { beforeAll, expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { RECOGNIZE_TOLERANCE, RecognizeError } from '@3db/regen';
import { recognizeStep } from './recognize-rolling-ball.kit';
import { cupWithBentWindow, cupWithLoftWindow, type LoftCup } from './recognize-loft-window.kit';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const CUP = { chord: 3, near: 10, far: 24, r: 18.5, wall: 1, height: 16 };

async function check(p: LoftCup) {
  const shape = cupWithLoftWindow(kernel, p);
  try {
    // the premise: two B-spline faces, the wall and the chords' face, which is flat (the loft makes it a B-spline, square to y)
    const faces = kernel.topology(shape).faces;
    const spline = faces.flatMap((f, i) => (f.surface === 'bsplinesurface' ? [i] : []));
    expect(spline).toHaveLength(2);
    const flat = spline.map((i) => kernel.flatFace(shape, i, 1e-7));
    expect(flat.filter((f) => f === null)).toHaveLength(1);
    expect(Math.abs(flat.find((f) => f !== null)!.normal[1])).toBeGreaterThan(1 - 1e-9);
    const r = await recognizeStep(kernel, solver, shape);
    expect(r.report.volumeError).toBeLessThan(RECOGNIZE_TOLERANCE);
    expect(r.report.difference).toBeLessThan(RECOGNIZE_TOLERANCE);
    expect(r.doc.features.filter((f) => f.type === 'revolve')).toHaveLength(1);
    expect(r.doc.features.filter((f) => f.type === 'loft' && f.op === 'cut')).toHaveLength(1);
  } finally {
    kernel.release(shape);
  }
}

it('a cup with a window lofted between planes 28° apart: the revolve and one loft cut, the same solid', async () => {
  await check({ ...CUP, first: [[-4, 3], [0, 11], [4, 3]], second: [[-5, 3], [-1, 9], [2, 12], [5, 3]], tilt: 28 });
}, 180_000);

it('turned the other way (-15°)', async () => {
  await check({ ...CUP, first: [[-3, 3], [0, 10], [3, 3]], second: [[-3.5, 3], [0, 12], [3.5, 3]], tilt: -15 });
}, 180_000);

it('parallel planes (0°): a loft that is no draft', async () => {
  await check({ ...CUP, first: [[-3, 3], [-1, 8], [1, 11], [3, 3]], second: [[-4, 3], [0, 9], [4, 3]], tilt: 0 });
}, 180_000);

/**
 * The limit on the wall: within a sixth of the file's own precision there (measured on this part, 1.48e-6 mm) of the ruled surface between its rails
 * moved onto their planes. One rail bent off its plane: by 1e-5 mm the wall is 8.98e-7 mm off, by 1e-3 mm 8.98e-5 mm. Both must be refused. Without
 * this limit both were rebuilt, and so was a bend of 1e-2 mm (the wall 8.98e-4 mm off, volume error 2.68e-8): the comparison of the whole solids does
 * not see a wall that far off, so the limit is the only check on it (measured, 2026-11-18). The same tool unbent is the control: rebuilt.
 */
it('a rail bent off its plane is refused; the same tool unbent is rebuilt', async () => {
  const p = { ...CUP, first: [[-4, 3], [0, 11], [4, 3]], second: [[-5, 3], [-1, 9], [2, 12], [5, 3]], tilt: 28 };
  for (const bump of [0, 1e-5, 1e-3]) {
    const shape = cupWithBentWindow(kernel, p, bump);
    try {
      let refused: unknown = null;
      try {
        const r = await recognizeStep(kernel, solver, shape);
        expect(r.report.volumeError).toBeLessThan(RECOGNIZE_TOLERANCE);
        expect(r.doc.features.filter((f) => f.type === 'loft' && f.op === 'cut')).toHaveLength(1);
      } catch (e) {
        refused = e;
      }
      if (bump === 0) expect(refused, 'the unbent control').toBeNull();
      else expect(refused, `bent by ${bump}`).toBeInstanceOf(RecognizeError);
    } finally {
      kernel.release(shape);
    }
  }
}, 300_000);
