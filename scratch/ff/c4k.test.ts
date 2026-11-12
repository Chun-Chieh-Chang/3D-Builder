import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { XY } from '../../tests/phase8/recognize-rolling-ball.kit';
it('c4k', async () => {
  const kernel = await Kernel.load();
  const outer = kernel.extrude(XY as never, [{ outer: [{ kind: 'circle', c: [0, 0], r: 15, source: 'c' }], holes: [] }] as never, [0, 0, 8]).shape;
  const inner = kernel.extrude({ ...XY, origin: [0, 0, -1] } as never, [{ outer: [{ kind: 'circle', c: [0, 0], r: 6, source: 'c' }], holes: [] }] as never, [0, 0, 10]).shape;
  const s = kernel.boolean('cut', outer, inner).shape;
  const b = kernel.toBSpline(s);
  for (const id of [s, b]) appendFileSync('scratch/ff/c4k.log', kernel.topology(id).faces.map((f) => `${f.surface} area ${f.area} c ${f.center.map((x) => x.toFixed(6))}`).join(' | ') + '\n');
}, 600_000);
