// Heap over N drafted extrusions in a fresh heap (AGENTS §3.5), W = spline (the new edge-by-edge path), rect (DraftAngle's path, control), plain
// (the spline outline extruded straight, control). Also liveShapes before and after (this program's own release duty).
import { appendFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Kernel } from '@3db/kernel';

const log = (m: string) => appendFileSync('scratch/ff/c7.log', m + String.fromCharCode(10));
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const L = (a: number[], b: number[], source: string) => ({ kind: 'line', a, b, source });

it('c7f', async () => {
  const kernel = await Kernel.load();
  const heap = () => (kernel.oc as any).wasmMemory.buffer.byteLength / 2 ** 20;
  const h0 = heap();
  expect(h0).toBeGreaterThan(0);
  const W = process.env.W ?? 'spline';
  const N = Number(process.env.N ?? 40);
  const spline = [L([0, 0], [28.72, 0], 'a'), L([28.72, 0], [28.72, 25], 'b'), { kind: 'spline', points: [[28.72, 25], [14, 32], [0, 25]], source: 'c' }, L([0, 25], [0, 0], 'd')];
  const rect = [L([0, 0], [28, 0], 'a'), L([28, 0], [28, 25], 'b'), L([28, 25], [0, 25], 'c'), L([0, 25], [0, 0], 'd')];
  const live = kernel.liveShapes;
  const steps: string[] = [];
  for (let i = 1; i <= N; i++) {
    const r = W === 'rect' ? kernel.extrude(XY as never, [{ outer: rect, holes: [] }] as never, [0, 0, 10], 0, undefined, 0.035)
      : W === 'plain' ? kernel.extrude(XY as never, [{ outer: spline, holes: [] }] as never, [0, 0, 10])
      : kernel.extrude(XY as never, [{ outer: spline, holes: [] }] as never, [0, 0, 10], 0, undefined, W === 'widen' ? -0.035 : 0.035);
    kernel.release(r.shape);
    if (i % (N / 8) === 0) steps.push(heap().toFixed(1));
  }
  log(`heap ${W} N=${N}: ${h0.toFixed(1)} -> ${steps.join(' ')} MiB; liveShapes ${live} -> ${kernel.liveShapes}`);
}, 900_000);
