/**
 * ADR 0265 memory (AGENTS.md §3.1, §3.5): a fillet made on the body cut at its joints copies the body once (ShapeUpgrade_ShapeDivideContinuity) and
 * fillets the copy. What it makes is released (`liveShapes`, strictly equal over the repetitions); the Emscripten heap is measured by its one true path,
 * `wasmMemory.buffer.byteLength`, over enough repetitions to pass the heap's slack, and set beside the same count of fillets of a box (not cut) — the
 * cost the cut adds. The control, sections of a plate (an OCCT boolean), shows the measure sees growth at all. In a file of its own, for a fresh heap.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type Frame, type Region, type ShapeId } from '@3db/kernel';
import { sample, splineBoss } from './recognize-rolling-ball.kit';

let kernel: Kernel;
let plate: ShapeId;
const heap = () => (kernel.oc as unknown as { wasmMemory?: { buffer?: ArrayBuffer } }).wasmMemory!.buffer!.byteLength;
const MiB = 1024 * 1024;
const ROUNDS = Number(process.env.ROUNDS ?? 300);

beforeAll(async () => {
  kernel = await Kernel.load();
  const frame: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
  const c: [number, number][] = [[0, 0], [40, 0], [40, 30], [0, 30]];
  const rect: Region = { outer: c.map((a, i) => ({ kind: 'line' as const, a, b: c[(i + 1) % 4]!, source: `r${i}` })), holes: [] };
  plate = kernel.extrude(frame, [rect], [0, 0, 20]).shape;
});

describe('fillet on a body cut at its joints and the heap', () => {
  it(`every shape is released over ${ROUNDS} cut fillets; their heap growth is measured beside uncut ones, and a control shows the measure sees growth`, () => {
    const initial = heap();
    const s = sample(50);
    const m = splineBoss(kernel, s.top, s.h);
    const live = kernel.liveShapes;
    const run = (shape: ShapeId, edges: number[], r: number, how: string) => {
      const before = heap();
      for (let n = 0; n < ROUNDS; n++) {
        const out = kernel.fillet(shape, edges, r);
        expect(kernel.lastFilletCut).toBe(how);
        kernel.release(out.shape);
        expect(kernel.liveShapes).toBe(live);
      }
      return (heap() - before) / MiB;
    };
    const cut = run(m.shape, m.edges, s.radius, 'cut');
    const box = run(plate, [0], 2, 'none');
    const beforeControl = heap();
    for (let n = 0; n < 1000; n++) kernel.sectionView(plate, { origin: [0, 0, 10], normal: [0, 0, 1] }, [0, 1, 0]);
    const control = (heap() - beforeControl) / MiB;
    expect(kernel.liveShapes).toBe(live);
    console.info(`heap growth over ${ROUNDS}: cut fillets ${cut.toFixed(1)} MiB, box fillets ${box.toFixed(1)} MiB, control 1000 sections ${control.toFixed(1)} MiB (from ${(initial / MiB).toFixed(0)} MiB)`);
    expect(control).toBeGreaterThan(0);
  }, 1_200_000);
});
