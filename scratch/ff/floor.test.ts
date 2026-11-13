import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { __body, sample } from '../../packages/kernel/test/exact-round-fuzz.kit';
const log = (m: string) => appendFileSync('scratch/ff/floor.log', m + String.fromCharCode(10));
it('floor', async () => {
  const kernel = await Kernel.load(); const k = kernel as any;
  const round = (s: number, exact: boolean) => { const input = sample(s); const { shape, edges } = __body(kernel, input); return kernel.fillet(shape, edges, input.r, undefined, undefined, exact).shape; };
  for (const [name, sh] of [['exact41', round(41, true)], ['occt41', round(41, false)], ['exact7', round(7, true)], ['occt7', round(7, false)]] as const) {
    for (const via of [false, true]) {
      const s = via ? kernel.importStep(new TextEncoder().encode(kernel.exportStep(sh, 'p'))).shape : sh;
      const t = kernel.fileTolerance(s);
      log(`${name} step=${via} count ${t.count} max ${t.max.toExponential(2)}`);
    }
  }
}, 600_000);
