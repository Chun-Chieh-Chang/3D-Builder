/**
 * ADR 0259 slice 1: the Emscripten heap over recognitions of a cup with a drafted spline window, in a file of its own for a fresh heap (AGENTS §3.5).
 * This program's own duty is that every shape it makes is released: `liveShapes` is back where it was after 40 recognitions. The heap is not claimed
 * flat. Measured (2026-11-18): +1391.9 MiB over 40 drafted recognitions (about 35 MiB each), +190.6 MiB over 40 of the straight control; over the
 * fuzz files 128 -> 1776 and 2032 MiB over 50 cases each; one recognition alone shows +0.0, absorbed by the heap's headroom (the §3.5 trap). The
 * window adds no Boolean of its own (it reads the file's curve, `Kernel.wallRail`); the growth is OCCT's with B-spline operands in the rebuild and its
 * comparison, bounded in the app by the worker's restart (ADR 0126). Printed, with the straight control.
 */
import { expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { cupWithWindow } from './recognize-revolved-window.kit';
import { recognizeStep } from './recognize-rolling-ball.kit';

const RUNS = 40;

it('releases every shape over 40 recognitions of a cup with a window; the heap is printed, with a straight control', async () => {
  const run = async (draft: number) => {
    const kernel = await Kernel.load();
    const solver = await PlaneGcsSolver.create();
    const heap = () => (kernel.oc as unknown as { wasmMemory?: WebAssembly.Memory }).wasmMemory?.buffer?.byteLength ?? NaN;
    const initial = heap();
    expect(initial).toBeGreaterThan(0);
    const live = kernel.liveShapes;
    for (let i = 0; i < RUNS; i++) {
      const shape = cupWithWindow(kernel, { top: [[-4, 4], [0, 12], [4, 4]], draft, r: 18.5, wall: 1, height: 16 });
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
  const drafted = await run(1.5);
  const straight = await run(0);
  console.log(`cup window recognition heap over ${RUNS}: +${drafted.toFixed(1)} MiB; straight control: +${straight.toFixed(1)} MiB`);
}, 1_800_000);
