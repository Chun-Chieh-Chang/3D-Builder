import { expect, it } from 'vitest';
import { Kernel } from '../src';
import { __body, sample } from './exact-round-fuzz.kit';

// Forty rebuilds, not six: the first ten or so of any leak land in the heap's spare room and read +0.0 (AGENTS.md §3.5). On this seed, with
// EvalD1/EvalD2 in the hot loops, six rebuilds stayed at 128.0 MiB while forty reached 550.7 MiB.
const REBUILDS = 40;

it('bounds WASM heap growth when rebuilding the same exact rounds', async () => {
  const kernel = await Kernel.load();
  const heapBytes = () => (kernel.oc as unknown as { wasmMemory?: WebAssembly.Memory }).wasmMemory?.buffer?.byteLength ?? NaN;
  const initial = heapBytes();
  expect(initial).toBeGreaterThan(0);
  const input = sample(41);
  const { shape, edges } = __body(kernel, input);
  expect(edges.length).toBeGreaterThan(0);
  const steps: string[] = [];
  try {
    for (let i = 0; i < REBUILDS; i++) {
      const result = kernel.fillet(shape, edges, input.r, undefined, undefined, true);
      try {
        expect(kernel.exactRoundLog.map(({ outcome }) => outcome)).toEqual(['exact', 'exact']);
      } finally {
        kernel.release(result.shape);
      }
      steps.push((heapBytes() / 2 ** 20).toFixed(1));
    }
  } finally {
    kernel.release(shape);
  }
  console.log(`exact-round heap over ${REBUILDS} rebuilds: ${(initial / 2 ** 20).toFixed(1)} -> ${steps.join(' ')} MiB`);
  // Measured (2026-11-10): derivatives into reused outputs, 128.0 -> 153.6 MiB (one step, at the 38th rebuild); EvalD1/EvalD2 in the hot loops,
  // 128.0 -> 550.7 MiB. What remains is not this module's ownership: OCCT's own round of this body rebuilt 1500 times grows 128 -> 459 MiB, and
  // shapes made and freed in this build are not all returned (§3.5); ADR 0126's worker restart bounds it in the product.
  expect(heapBytes() - initial).toBeLessThanOrEqual(32 * 2 ** 20);
}, 300_000);
