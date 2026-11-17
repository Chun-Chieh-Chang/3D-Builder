/**
 * ADR 0255: the Emscripten heap over recognitions of a drafted spline boss through STEP, in a file of its own for a fresh heap (AGENTS §3.5). This
 * program's own duty is that every shape it makes is released: `liveShapes` is back where it was after six recognitions. The heap is not claimed flat:
 * measured, the section that cuts each layer is an OCCT Boolean, and with a B-spline wall among its operands it holds heap per call (the same with
 * `sectionEdges`, which reads nothing exactly: the OCCT-internal kind §3.5 records, bounded in the app by the worker's restart, ADR 0126). Printed
 * with a control: the same boss extruded straight, whose wall is a plain B-spline curve carried straight.
 */
import { expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { draftedSpline } from './recognize-drafted-spline.kit';
import { recognizeStep } from './recognize-rolling-ball.kit';

const TOP = [[28.72, 25], [14, 32], [0, 25]];
const RUNS = 6;

it('releases every shape over six recognitions of a drafted spline boss; the heap is printed, with a straight control', async () => {
  const run = async (draft: number) => {
    const kernel = await Kernel.load();
    const solver = await PlaneGcsSolver.create();
    const heap = () => (kernel.oc as unknown as { wasmMemory?: WebAssembly.Memory }).wasmMemory?.buffer?.byteLength ?? NaN;
    const initial = heap();
    expect(initial).toBeGreaterThan(0);
    const live = kernel.liveShapes;
    for (let i = 0; i < RUNS; i++) {
      const shape = draftedSpline(kernel, { top: TOP, h: 10, draft, plate: true, foot: 1.2 });
      try {
        const r = await recognizeStep(kernel, solver, shape);
        expect(r.report.volumeError).toBeLessThan(1e-6);
      } finally {
        kernel.release(shape);
      }
    }
    expect(kernel.liveShapes).toBe(live);
    return (heap() - initial) / 2 ** 20;
  };
  const drafted = await run(3);
  const straight = await run(0);
  console.log(`drafted spline recognition heap over ${RUNS}: +${drafted.toFixed(1)} MiB; straight control: +${straight.toFixed(1)} MiB`);
}, 900_000);
