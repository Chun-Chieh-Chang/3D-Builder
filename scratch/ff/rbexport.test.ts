// Seed SEED: how long the STEP export of its rounded boss takes, alone, with and without first exporting the plain boss; the exact-round log.
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { sample, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';
it('export', async () => {
  const kernel = await Kernel.load(); const k = kernel as any;
  const s = sample(Number(process.env.SEED ?? 10)); const m = splineBoss(kernel, s.top, s.h);
  let t0 = performance.now();
  const made = kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, true).shape;
  console.log('EX fillet', ((performance.now() - t0) / 1000).toFixed(1), 's', JSON.stringify(k.exactRoundLog), process.env.NOCHECK ? '' : JSON.stringify(kernel.check(made)).slice(0, 80));
  t0 = performance.now();
  const step = kernel.exportStep(made, 'p');
  console.log('EX export', ((performance.now() - t0) / 1000).toFixed(1), 's', step.length, 'bytes');
}, 1_200_000);
