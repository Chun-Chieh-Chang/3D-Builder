/**
 * ADR 0173 / 0174, memory (AGENTS.md §3.1, §3.5): finding where a curve crosses a plane, and the place of a curve nearest a point, only evaluate the curve —
 * no boolean. What they make is released (`liveShapes`); the Emscripten heap is measured by its one true path, `wasmMemory.buffer.byteLength`, after
 * enough repetitions to pass the heap's slack (2000 rounds over the 4 turns of a helix, both calls), and reported — not asserted to be zero. The control, a
 * section of a plate (an OCCT boolean), shows that the measure sees growth at all. In a file of its own, for a fresh heap.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type Frame, type Region, type ShapeId } from '@3db/kernel';

let kernel: Kernel;
let helix: ShapeId;
let plate: ShapeId;
const heap = () => (kernel.oc as unknown as { wasmMemory?: { buffer?: ArrayBuffer } }).wasmMemory?.buffer?.byteLength;
const MiB = 1024 * 1024;

beforeAll(async () => {
  kernel = await Kernel.load();
  helix = kernel.helixCurve({ center: [0, 0, 0], normal: [0, 0, 1], refDir: [1, 0, 0], radius: 10, pitch: 5, revolutions: 4, height: 20, clockwise: false } as never).shape;
  const frame: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
  const c: [number, number][] = [[0, 0], [40, 0], [40, 30], [0, 30]];
  const rect: Region = { outer: c.map((a, i) => ({ kind: 'line' as const, a, b: c[(i + 1) % 4]!, source: `r${i}` })), holes: [] };
  plate = kernel.extrude(frame, [rect], [0, 0, 20]).shape;
});

describe('curve evaluation and the heap', () => {
  it('every shape is released; the heap growth of 2000 rounds of crossings and nearest points is measured, and a control shows the measure sees growth', () => {
    const initial = heap();
    expect(initial).toBeGreaterThan(0);
    const live = kernel.liveShapes;
    const edges = kernel.topology(helix).edges.map((_, i) => i);
    const before = heap()!;
    let found = 0;
    for (let n = 0; n < 2000; n++) {
      for (const e of edges) {
        found += kernel.edgePlaneCrossings(helix, e, { origin: [0, 0, 0], normal: [0, 1, 0] }).length;
        kernel.edgeNearest(helix, e, [0, 0, 6]);
      }
    }
    const curves = (heap()! - before) / MiB;
    expect(found).toBe(2000 * 12); // the 9 places of y = 0, the 3 shared turn ends counted by both turns
    const beforeControl = heap()!;
    for (let n = 0; n < 1000; n++) kernel.sectionView(plate, { origin: [0, 0, 10], normal: [0, 0, 1] }, [0, 1, 0]);
    const control = (heap()! - beforeControl) / MiB;
    expect(kernel.liveShapes).toBe(live);
    expect(control).toBeGreaterThan(0);
    console.info(`heap growth: 2000 rounds of crossings + nearest ${curves.toFixed(2)} MiB, control 1000 sections ${control.toFixed(2)} MiB (from ${(initial! / MiB).toFixed(0)} MiB)`);
  }, 600_000);
});
