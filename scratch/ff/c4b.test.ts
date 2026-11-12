// C4 feasibility: part-4 with the freeform gate off (NOGATE=1) — how far does the rest of recognition get?
import { appendFileSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { recognize, RecognizeError } from './analyze.c4';
import { frameFor } from '../../packages/regen/src/recognize/reconstruct';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';
const log = (m: string) => { appendFileSync('scratch/ff/c4b.log', m + String.fromCharCode(10)); console.log(m); };
it('c4b', async () => {
  const kernel = await Kernel.load();
  const whole = new Uint8Array(readFileSync('D:/3DB實機確認/組合圖(R1-10226+R1-10134).STEP'));
  const id = kernel.importStep(stepAssemblyPlan(kernel, whole).prototypes.filter((p: any) => p.part)[+(process.env.PART ?? 3)]!.part!.step).shape;
  const heap = () => ((kernel.oc as any).wasmMemory.buffer.byteLength / 2 ** 20).toFixed(0);
  const t0 = performance.now();
  try {
    const r = recognize(kernel, id, frameFor as any, undefined, undefined, {});
    log(`recognized base ${r.base.type} holes ${r.holes.length} blends ${r.blends.length} counts ${JSON.stringify(r.counts)}`);
    if (r.base.type === 'composite') log(`extras ${r.base.extras.length} inner ${r.base.base.type}`);
  } catch (e) { log(`${e instanceof RecognizeError ? 'refused' : 'ERROR'}: ${String((e as Error).message).slice(0, 1500)}`); }
  log(`ms ${Math.round(performance.now() - t0)} heap ${heap()} MiB`);
}, 900_000);
