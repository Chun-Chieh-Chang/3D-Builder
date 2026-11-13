// Heap per stage of the drafted extrusion's new path (temporary PROBE_STOP stops in kernel.ts, removed after): N runs stopped after stage k.
import { appendFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Kernel } from '@3db/kernel';

const log = (m: string) => appendFileSync('scratch/ff/c7.log', m + String.fromCharCode(10));
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const L = (a: number[], b: number[], source: string) => ({ kind: 'line', a, b, source });

it('c7h', async () => {
  const kernel = await Kernel.load();
  const heap = () => (kernel.oc as any).wasmMemory.buffer.byteLength / 2 ** 20;
  const h0 = heap();
  expect(h0).toBeGreaterThan(0);
  const N = Number(process.env.N ?? 40);
  const spline = [L([0, 0], [28.72, 0], 'a'), L([28.72, 0], [28.72, 25], 'b'), { kind: 'spline', points: [[28.72, 25], [14, 32], [0, 25]], source: 'c' }, L([0, 25], [0, 0], 'd')];
  const steps: string[] = [];
  let stopped = 0;
  for (let i = 1; i <= N; i++) {
    try {
      const r = kernel.extrude(XY as never, [{ outer: spline, holes: [] }] as never, [0, 0, 10], 0, undefined, -0.035);
      kernel.release(r.shape);
    } catch (e) {
      if (!String((e as Error).message).startsWith('probe')) throw e;
      stopped++;
    }
    if (i % (N / 8) === 0) steps.push(heap().toFixed(1));
  }
  log(`stage ${process.env.PROBE_STOP ?? 'full'} N=${N} (stopped ${stopped}): ${h0.toFixed(1)} -> ${steps.join(' ')} MiB; liveShapes ${kernel.liveShapes}`);
}, 900_000);
