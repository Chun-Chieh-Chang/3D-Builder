// trace the OUT branch of toFace on the drill point (TEMP-TRACE in surfaceDeviation.ts)
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
const log = (m: string) => appendFileSync('scratch/ff/drill3.log', m + String.fromCharCode(10));
it('drill3', async () => {
  const kernel = await Kernel.load();
  const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
  const XZ = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] };
  const poly = (pts: number[][]) => ({ outer: pts.map((a, i) => ({ kind: 'line', a, b: pts[(i + 1) % pts.length], source: 'e' + i })), holes: [] });
  const plate = kernel.extrude(XY as any, [poly([[-30, -20], [30, -20], [30, 20], [-30, 20]])] as any, [0, 0, 10]).shape;
  const point = 3 / Math.tan((59 * Math.PI) / 180);
  const tool = kernel.revolve(XZ as any, [poly([[0, 11], [3, 11], [3, 6], [0, 6 - point]])] as any, { origin: [0, 0, 0], dir: [0, 0, 1] } as any, 2 * Math.PI).shape;
  const a = kernel.boolean('cut', plate, tool).shape;
  const b = kernel.importStep(new TextEncoder().encode(kernel.exportStep(a, 'p'))).shape;
  let n = 0; const f = (x: number) => x.toFixed(4);
  (globalThis as any).__TRACE__ = (t: any) => { if (t.d > 1e-6 && n++ < 25) log(`f${t.f} p(${t.p.map(f)}) start(${f(t.u0)},${f(t.v0)}) end(${f(t.u)},${f(t.v)}) ${t.s} d ${t.d.toExponential(2)}`); };
  const d = kernel.surfaceDeviation(a, b);
  log(`total ${d.integral} traced-out>1e-6 ${n}`);
}, 600_000);
