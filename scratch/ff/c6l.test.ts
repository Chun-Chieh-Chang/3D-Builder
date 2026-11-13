// Is the MakeDraft trap the symmetry of the spline? JOB = variant: the spline's middle point at the exact middle, or moved off it by dx.
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { isTrap, Kernel } from '@3db/kernel';
const log = (m: string) => appendFileSync('scratch/ff/c6.log', m + String.fromCharCode(10));
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const L = (a: number[], b: number[], source: string) => ({ kind: 'line', a, b, source });
it('c6l', async () => {
  const [name, dxs] = process.env.JOB!.split(':');
  const dx = Number(dxs);
  const base: Record<string, { w: number; h: number; my: number }> = { trap4: { w: 38.091, h: 17.995, my: 15.941 }, outline: { w: 28.72, h: 25, my: 32 }, s38: { w: 33.015, h: 27.269, my: 35.101 } };
  const b = base[name!]!;
  const outer = [L([0, 0], [b.w, 0], 'a'), L([b.w, 0], [b.w, b.h], 'b'), { kind: 'spline', points: [[b.w, b.h], [b.w / 2 + dx, b.my], [0, b.h]], source: 'c' }, L([0, b.h], [0, 0], 'd')];
  const kernel = await Kernel.load();
  let out: string;
  try {
    const r = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, 10], 0, undefined, 0.02);
    out = `ok valid ${kernel.check(r.shape).valid}`;
  } catch (e) { out = isTrap(e) ? 'TRAP' : `refused ${String((e as Error).message).slice(0, 60)}`; }
  log(`symmetry ${name} middle at w/2 ${dx >= 0 ? '+' : ''}${dx}: ${out}`);
}, 300_000);
