import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { sample, __body } from '../../packages/kernel/test/exact-round-fuzz.kit';
// C2.14d: one seed rebuilt N times on a fresh heap. SEED, N, XMODE=occt|exact. Heap read before body, after body, after each round.
it('heaprep', async () => {
  const kernel = await Kernel.load(); const H = () => (kernel.oc as any).wasmMemory.buffer.byteLength / 2 ** 20;
  const h0 = H(); if (!(h0 > 0)) throw new Error('no heap');
  const s = sample(Number(process.env.SEED)); const made = __body(kernel, s); const hb = H();
  const steps: string[] = [];
  for (let i = 0; i < Number(process.env.N ?? 6); i++) {
    const r = kernel.fillet(made.shape, made.edges, s.r, undefined, undefined, process.env.XMODE === 'exact');
    kernel.release(r.shape); steps.push(H().toFixed(1));
  }
  const log = process.env.XMODE === 'exact' ? (kernel as any).exactRoundLog.map((x: any) => x.outcome).join(',') : '';
  console.log('HEAPREP', process.env.SEED, process.env.XMODE, JSON.stringify({ h0, body: hb, steps, log }));
}, Number(process.env.TMO ?? 170_000));
