import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { sample, __body } from '../../packages/kernel/test/exact-round-fuzz.kit';
// C2.14d: BRepCheck_Analyzer N times on one result (WHICH=exact|occt), each deleted, fresh heap. Isolates BRepCheck from exactify.
it('brcheck', async () => {
  const kernel: any = await Kernel.load(); const oc = kernel.oc; const H = () => oc.wasmMemory.buffer.byteLength / 2 ** 20;
  const h0 = H(); if (!(h0 > 0)) throw new Error('no heap');
  const s = sample(Number(process.env.SEED ?? 41)); const made = __body(kernel, s);
  const r = kernel.fillet(made.shape, made.edges, s.r, undefined, undefined, process.env.WHICH === 'exact');
  const log = kernel.exactRoundLog.map((x: any) => x.outcome).join(',');
  const shape = kernel.get(r.shape); const hb = H(); const steps: string[] = [];
  const N = Number(process.env.N ?? 200);
  for (let i = 0; i < N; i++) { const a = new oc.BRepCheck_Analyzer(shape, true, false, false); a.IsValid(); a.delete(); if ((i + 1) % 20 === 0) steps.push(H().toFixed(1)); }
  console.log('BRCHECK', process.env.WHICH, JSON.stringify({ h0, afterFillet: hb, steps, log }));
}, 600_000);
