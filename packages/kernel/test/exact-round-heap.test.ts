import { expect, it } from 'vitest';
import { Kernel } from '../src';
import { __body, sample } from './exact-round-fuzz.kit';

it('bounds WASM heap growth when rebuilding the same exact rounds', async () => {
  const kernel = await Kernel.load();
  const heapBytes = () => (kernel.oc as unknown as { wasmMemory?: WebAssembly.Memory }).wasmMemory?.buffer?.byteLength ?? NaN;
  const initial = heapBytes();
  expect(initial).toBeGreaterThan(0);
  const input = sample(80);
  const { shape, edges } = __body(kernel, input);
  expect(edges.length).toBeGreaterThan(0);
  try {
    for (let i = 0; i < 6; i++) {
      const result = kernel.fillet(shape, edges, input.r, undefined, undefined, true);
      try {
        expect(kernel.exactRoundLog.map(({ outcome }) => outcome)).toEqual(['exact', 'exact']);
      } finally {
        kernel.release(result.shape);
      }
    }
  } finally {
    kernel.release(shape);
  }
  console.log(`exact-round heap: ${(initial / 2 ** 20).toFixed(1)} -> ${(heapBytes() / 2 ** 20).toFixed(1)} MiB`);
  // Before reusing derivative outputs, this seed took a fresh 128 MiB heap to 265.5 MiB in six rebuilds.
  expect(heapBytes() - initial).toBeLessThanOrEqual(32 * 2 ** 20);
}, 60_000);
