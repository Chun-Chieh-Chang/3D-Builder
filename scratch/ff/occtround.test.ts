import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { recognizeStep, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';
const log = (m: string) => appendFileSync('scratch/ff/occtround.log', m + String.fromCharCode(10));
it('occtround', async () => {
  const kernel = await Kernel.load(); const solver = await PlaneGcsSolver.create();
  for (const r of [0.5, 0.8, 1.2]) {
    const plain = splineBoss(kernel);
    const occt = kernel.fillet(plain.shape, plain.edges, r, undefined, undefined, false);
    const t = kernel.fileTolerance(kernel.importStep(new TextEncoder().encode(kernel.exportStep(occt.shape, 'p'))).shape);
    const out: any = await recognizeStep(kernel, solver, occt.shape).catch((x: unknown) => x);
    const rep = out?.report;
    log(`ALLOW=${process.env.NOALLOW ? 'off' : 'on'} r ${r} ft count ${t.count} max ${t.max.toExponential(2)} -> ${rep ? `ok vol ${rep.volumeError.toExponential(2)} area ${rep.areaError.toExponential(2)} diff ${rep.difference?.toExponential(2)} ft ${JSON.stringify(rep.fileTolerance)} features ${JSON.stringify(rep.features)}` : String(out?.message ?? out).slice(0, 200)}`);
  }
}, 600_000);
