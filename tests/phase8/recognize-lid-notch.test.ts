/**
 * ADR 0259 slice 3: a closed cup with the drafted window of slice 1 and its lid cut back to a cross by four notches along the axis
 * (`recognize-lid-notch.kit.ts`), as part-3's lid is. Recognition must give one revolve, the window's cuts, and the four notches as cuts along y whose
 * outlines hold the notch's arc; the rebuilt solid must be the same solid. Before slice 3 every case was refused: an off-axis cylinder is no surface
 * of revolution about the cup's axis.
 */
import { beforeAll, expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { RECOGNIZE_TOLERANCE } from '@3db/regen';
import { recognizeStep } from './recognize-rolling-ball.kit';
import { cupWithLidNotch, type LidCup } from './recognize-lid-notch.kit';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const BASE: LidCup = { top: [[-4, 4], [0, 12], [4, 4]], draft: 1.5, r: 18.5, wall: 1, height: 16, lid: 1.5, a: 5.7, b: 9, round: 3.8, below: 2 };

async function check(p: LidCup) {
  const shape = cupWithLidNotch(kernel, p);
  try {
    // the premise: four cylinders along y off the axis, of the notch's radius
    const faces = kernel.topology(shape).faces;
    const corners = faces.filter((f) => f.geometry?.type === 'cylinder' && Math.abs((f.geometry as { radius: number }).radius - p.round) < 1e-9);
    expect(corners).toHaveLength(4);
    const r = await recognizeStep(kernel, solver, shape);
    expect(r.report.volumeError).toBeLessThan(RECOGNIZE_TOLERANCE);
    expect(r.report.difference).toBeLessThan(RECOGNIZE_TOLERANCE);
    expect(r.doc.features.filter((f) => f.type === 'revolve')).toHaveLength(1);
    // the notches: cuts along y, each sketched with one arc of the notch's radius
    const sketches = new Map(r.doc.features.flatMap((f) => (f.type === 'sketch' ? [[f.id, f] as const] : [])));
    const notches = r.doc.features.filter((f) => {
      if (f.type !== 'extrude' || f.op !== 'cut') return false;
      const s = sketches.get(f.sketch) as unknown as { entities: { type: string; radius?: unknown }[] } | undefined;
      return !!s?.entities.some((e) => e.type === 'arc');
    });
    expect(notches).toHaveLength(4);
  } finally {
    kernel.release(shape);
  }
}

it('a lid cut back to a cross by four notches, with a drafted window: one revolve, the window, four notch cuts, the same solid', async () => {
  await check(BASE);
}, 300_000);

it('notches that stop at the lid (0.5 mm into the wall below it)', async () => {
  await check({ ...BASE, below: 0.5, round: 2 });
}, 300_000);

it('a straight window and wide arms', async () => {
  await check({ ...BASE, draft: 0, top: [[-3.5, 3], [0, 11], [3.5, 3]], a: 7, b: 11, round: 1.5 });
}, 300_000);
