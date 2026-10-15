/**
 * ADR 0146, memory (AGENTS.md §3.1, §3.5): shading a view meshes the shape it projects. What this program makes is released (`liveShapes`); the Emscripten heap is
 * measured by its one true path, `wasmMemory.buffer.byteLength`, after enough repetitions to pass the heap's slack, and reported — not asserted to be zero.
 *
 * Measured on 10-15, each in a fresh heap, 2000 isometric views of a 40 × 30 × 20 plate (`tests` of the scratch experiments, kept in DEV_LOG): hidden-line removal
 * alone +25.6 MiB (the part meshed before or not), the mesh alone +0.0, the two together +56.4 — so a shaded view costs about 0.015 MiB more than a plain one.
 * A view is shaded once per change and kept; the worker's high-water restart (ADR 0126) bounds what is left. The control below, a section (an OCCT boolean),
 * shows that the measure sees growth at all. In a file of its own, for a fresh heap.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { viewVectors } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { projectDrawingView, Regenerator } from '@3db/regen';
import { build, extrude, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let plate: ShapeId;
const kept: Regenerator[] = [];
const heap = () => (kernel.oc as unknown as { wasmMemory?: { buffer?: ArrayBuffer } }).wasmMemory?.buffer?.byteLength;
const MiB = 1024 * 1024;

beforeAll(async () => {
  kernel = await Kernel.load();
  const regen = new Regenerator(kernel, await PlaneGcsSolver.create());
  kept.push(regen);
  plate = regen.rebuild(build(sketch('s1', front, rectangle('a', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }))).body!.shape;
});

describe('shading and the heap', () => {
  it('every shape a shaded view makes is released; the heap growth of 2000 shaded views is measured, and a control shows the measure sees growth', () => {
    const initial = heap();
    expect(initial).toBeGreaterThan(0);
    const parts = [{ shape: plate, pose: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] }, mirrored: false }];
    const live = kernel.liveShapes;
    const run = (n: number, cut: { origin: [number, number, number]; normal: [number, number, number] } | undefined, mesh: boolean) => {
      const before = heap()!;
      for (let i = 0; i < n; i++) projectDrawingView(kernel, parts, viewVectors(cut ? 'front' : 'isometric'), cut, mesh);
      return (heap()! - before) / MiB;
    };
    const shaded = run(2000, undefined, true);
    const control = run(1000, { origin: [0, 0, 10], normal: [0, 0, 1] }, false);
    expect(kernel.liveShapes).toBe(live);
    expect(control).toBeGreaterThan(0);
    console.info(`heap growth: 2000 shaded views ${shaded.toFixed(2)} MiB, control 1000 sections ${control.toFixed(2)} MiB (from ${(initial! / MiB).toFixed(0)} MiB)`);
  }, 300_000);
});
