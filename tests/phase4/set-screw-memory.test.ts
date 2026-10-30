/** Isolated heap measurement: the heap buffer capacity is reported, not claimed as live allocated bytes. */
import { expect, it } from 'vitest';
import { standardLengths, standardPartDoc, standardSizes } from '@3db/library';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator, projectDrawingView } from '@3db/regen';
import { viewVectors } from '@3db/model';
import { statuses } from '../phase1/builders';

it('measures the heap across 200 randomized set screw builds and a growth-producing control', async () => {
  const kernel = await Kernel.load();
  const solver = await PlaneGcsSolver.create();
  const heap = () => (kernel.oc as unknown as { wasmMemory?: { buffer?: ArrayBuffer } }).wasmMemory?.buffer?.byteLength;
  const initial = heap();
  expect(initial).toBeGreaterThan(0);
  let seed = 4029;
  const sizes = standardSizes('setScrew');
  const lengths = standardLengths('setScrew');
  for (let i = 0; i < 200; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const size = sizes[seed % sizes.length]!;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const length = lengths[seed % lengths.length]!;
    const regen = new Regenerator(kernel, solver);
    const result = regen.rebuild(standardPartDoc({ kind: 'setScrew', size, length }));
    expect(statuses(result).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    regen.dispose();
  }
  const afterBuilds = heap()!;
  const regen = new Regenerator(kernel, solver);
  const shape = regen.rebuild(standardPartDoc({ kind: 'setScrew', size: 'M8', length: 20 })).body!.shape;
  const parts = [{ shape, pose: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] }, mirrored: false }];
  const beforeControl = heap()!;
  for (let i = 0; i < 1000; i++) projectDrawingView(kernel, parts, viewVectors('front'), { origin: [0, 0, 0], normal: [0, 0, 1] }, false);
  const afterControl = heap()!;
  expect(afterControl - beforeControl).toBeGreaterThan(0);
  process.stdout.write(`WASM heap MiB: initial ${(initial! / 1048576).toFixed(2)}, after 200 builds ${(afterBuilds / 1048576).toFixed(2)}, control growth ${((afterControl - beforeControl) / 1048576).toFixed(2)}\n`);
  regen.dispose();
}, 300_000);
