/**
 * IGES export and import (F1.4, F2.2), memory (AGENTS.md §3.1, §3.5): every shape they make is released (`liveShapes`), and the growth of the Emscripten heap,
 * measured by its one true path `wasmMemory.buffer.byteLength`, is reported, not asserted to be zero. Each case runs in a kernel of its own (each load is a
 * new WASM instance, so a fresh heap), enough times to pass the heap's slack; a control (a boolean cut, which §3.5 measured to grow the heap) shows that the
 * measure sees growth at all. In a file of its own.
 */
import { describe, expect, it } from 'vitest';
import { Kernel, type ShapeId } from '@3db/kernel';
import type { Frame, Region } from '@3db/kernel';

const MiB = 1024 * 1024;
const heapOf = (k: Kernel) => (k.oc as unknown as { wasmMemory?: { buffer?: ArrayBuffer } }).wasmMemory?.buffer?.byteLength;
const front: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const rect = (x: number, y: number, w: number, h: number): Region => ({
  outer: [
    { kind: 'line', a: [x, y], b: [x + w, y], source: 'l1' },
    { kind: 'line', a: [x + w, y], b: [x + w, y + h], source: 'l2' },
    { kind: 'line', a: [x + w, y + h], b: [x, y + h], source: 'l3' },
    { kind: 'line', a: [x, y + h], b: [x, y], source: 'l4' },
  ],
  holes: [],
});

/** A fresh kernel and a 40 × 30 × 20 plate in it; `run` is repeated `n` times after the start of the heap is taken. Growth in MiB. */
async function measure(n: number, run: (k: Kernel, plate: ShapeId) => void): Promise<{ growth: number; start: number }> {
  const k = await Kernel.load();
  const plate = k.extrude(front, [rect(0, 0, 40, 30)], [0, 0, 20]).shape;
  run(k, plate); // the first call sets up what the library keeps for good (its settings, the IGES norm)
  const start = heapOf(k);
  expect(start).toBeGreaterThan(0);
  const live = k.liveShapes;
  for (let i = 0; i < n; i++) run(k, plate);
  expect(k.liveShapes).toBe(live);
  return { growth: (heapOf(k)! - start!) / MiB, start: start! / MiB };
}

describe('IGES and the heap', () => {
  it('releases every shape; the growth of 2000 exports of each kind and 1000 imports is measured, and a control shows the measure sees growth', async () => {
    const faces = await measure(2000, (k, p) => void k.exportIges(p, 'P'));
    const brep = await measure(2000, (k, p) => void k.exportIges(p, 'P', 'MM', { mode: 'brep' }));
    const step = await measure(2000, (k, p) => void k.exportStep(p, 'P'));
    // OCCT's own writer alone, without the document, names, colors or anything of this program: what of the growth is the library's
    const bare = await measure(2000, (k, p) => {
      const oc = k.oc;
      const w = new oc.IGESControl_Writer('MM', 0);
      w.AddShape((k as unknown as { get(id: ShapeId): never }).get(p), new oc.Message_ProgressRange());
      w.ComputeModel();
      w.Write('/bare.igs', false);
      oc.FS.unlink('/bare.igs');
      w.delete();
    });
    let text = '';
    const read = await measure(1000, (k, p) => {
      text ||= k.exportIges(p, 'P');
      k.release(k.importIges(text).shape);
    });
    const control = await measure(1000, (k, p) => {
      const tool = k.extrude(front, [rect(10, 10, 5, 5)], [0, 0, 30]).shape;
      const cut = k.boolean('cut', p, tool);
      k.release(cut.shape);
      k.release(tool);
    });
    expect(control.growth).toBeGreaterThan(0);
    console.info(
      `heap growth from a fresh heap: 2000 IGES exports (faces) ${faces.growth.toFixed(2)} MiB, 2000 IGES exports (B-rep) ${brep.growth.toFixed(2)} MiB, ` +
        `2000 bare OCCT IGES writes ${bare.growth.toFixed(2)} MiB, 2000 STEP exports (for comparison) ${step.growth.toFixed(2)} MiB, 1000 IGES imports ${read.growth.toFixed(2)} MiB; control 1000 boolean cuts ${control.growth.toFixed(2)} MiB`,
    );
  }, 600_000);
});
