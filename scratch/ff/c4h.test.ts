import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { XY } from '../../tests/phase8/recognize-rolling-ball.kit';
it('c4h', async () => {
  const kernel = await Kernel.load();
  const s = kernel.extrude(XY as never, [{ outer: [{ kind: 'circle', c: [0, 0], r: 15, source: 'c' }], holes: [] }] as never, [0, 0, 8]).shape;
  writeFileSync('scratch/ff/disc-bspline.step', kernel.exportStep(kernel.toBSpline(s), 'p'));
}, 600_000);
