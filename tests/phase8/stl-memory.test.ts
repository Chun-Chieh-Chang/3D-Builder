/**
 * STL import and export (F2.3, F4.1, ADR 0221), memory (AGENTS.md §3.1, §3.5). An imported STL is read by plain TypeScript and never reaches the kernel, so a
 * part rebuilt with it, the file read again each time, must leave the Emscripten heap (its one true path, `wasmMemory.buffer.byteLength`) where it was and make
 * no shape. Each case runs in a kernel of its own (a fresh heap), enough times to pass the heap's slack; a control (a boolean cut, which §3.5 measured to grow
 * the heap) shows that the measure sees growth at all. Export meshes with the kernel: its growth is reported, not asserted to be zero. In a file of its own.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type Feature } from '@3db/model';
import { sha256Hex, writeStl } from '@3db/io';
import { Kernel, type Frame, type Region, type ShapeId } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator } from '@3db/regen';

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

/** A fresh kernel and a 40 × 30 × 20 plate in it; what `setup` returns is run `n` times after the start of the heap is taken. Growth in MiB. */
async function measure(n: number, setup: (k: Kernel, plate: ShapeId) => Promise<(i: number) => void>): Promise<number> {
  const k = await Kernel.load();
  const plate = k.extrude(front, [rect(0, 0, 40, 30)], [0, 0, 20]).shape;
  const run = await setup(k, plate);
  run(-1); // what the library keeps for good after a first call
  const start = heapOf(k);
  expect(start).toBeGreaterThan(0);
  const live = k.liveShapes;
  for (let i = 0; i < n; i++) run(i);
  expect(k.liveShapes).toBe(live);
  return (heapOf(k)! - start!) / MiB;
}

describe('STL and the heap', () => {
  it('an imported STL read again on each of 1000 rebuilds leaves the heap as it was; export is measured; a control grows', async () => {
    const solver = await PlaneGcsSolver.create();
    let triangles = 0;
    const imported = await measure(1000, async (k) => {
      // a cylinder meshed finely (thousands of triangles), written binary
      const oc = k.oc;
      const cylinder = (k as unknown as { put(s: unknown): ShapeId }).put(new oc.BRepPrimAPI_MakeCylinder(15, 30).Shape());
      const mesh = k.mesh(cylinder, { tolerance: 0.002, angular: 0.05 });
      k.release(cylinder);
      triangles = mesh.indices.length / 3;
      const stl = writeStl([mesh], 'cylinder');
      const sha = await sha256Hex(stl);
      return (i) => {
        const feature: Extract<Feature, { type: 'importedMesh' }> = { id: 'mesh1', type: 'importedMesh', name: '網格1', suppressed: false, blob: 'blob1', ...(i % 2 ? { unit: 'inch' as const } : {}) };
        const doc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'stl' }, feature, index: 0 });
        // a new regenerator each time: nothing read before is kept, so the file is read again
        const regen = new Regenerator(k, solver, new Map([[sha, stl]]));
        const r = regen.rebuild(doc);
        expect(r.features[0]!.status).toBe('ok');
        expect(r.meshes[0]!.mesh.closed).toBe(true);
        regen.dispose();
      };
    });
    const exported = await measure(1000, async (k, plate) => (i) => void writeStl([k.mesh(plate)], 'p', { format: i % 2 ? 'ascii' : 'binary' }));
    const control = await measure(1000, async (k, plate) => () => {
      const tool = k.extrude(front, [rect(10, 10, 5, 5)], [0, 0, 30]).shape;
      const cut = k.boolean('cut', plate, tool);
      k.release(cut.shape);
      k.release(tool);
    });
    console.log(`STL heap growth: 1000 imports of ${triangles} triangles +${imported.toFixed(2)} MiB; 1000 exports +${exported.toFixed(2)} MiB; control 1000 cuts +${control.toFixed(2)} MiB`);
    expect(triangles).toBeGreaterThan(1000);
    expect(control).toBeGreaterThan(0);
    expect(imported).toBe(0);
  });
});
