// surfaceDeviation against answers known without it: the same solid; a box moved by δ along x (V(A △ B) = 2·b·c·δ exactly); a cylinder grown by δ in
// radius (π((r+δ)² − r²)h exactly); a plate with a hole against one without (the hole's volume); seeds 26 / 10 (the boolean's trap and hang) and 2.
// Logged synchronously (vitest's console is lost when a run is cut).
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { sample, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';
const log = (m: string) => appendFileSync(process.env.LOG ?? 'scratch/ff/sdev.log', (performance.now() / 1000).toFixed(1) + ' ' + m + String.fromCharCode(10));
it('sdev', async () => {
  const kernel = await Kernel.load(); const k = kernel as any;
  const heap = () => +((k.oc.wasmMemory.buffer.byteLength) / 2 ** 20).toFixed(1);
  const show = (label: string, a: number, b: number, truth?: number) => {
    log('start ' + label);
    const t0 = performance.now(); const ab = kernel.surfaceDeviation(a, b); log('  ab ' + ab.samples); const ba = kernel.surfaceDeviation(b, a); const ms = performance.now() - t0;
    log(`SD ${label}: ab ${ab.integral.toExponential(4)} ba ${ba.integral.toExponential(4)}${truth ? ` truth ${truth.toExponential(4)} rel ${(Math.max(ab.integral, ba.integral) / truth - 1).toExponential(2)}` : ''} max ${Math.max(ab.max, ba.max).toExponential(2)} area ${ab.area.toFixed(4)} vs ${kernel.surfaceArea(a).toFixed(4)} n ${ab.samples}+${ba.samples} ${ms.toFixed(0)} ms heap ${heap()}`);
  };
  const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
  const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
  const box = (x: number, y: number, z: number, dx = 0) => kernel.extrude(XY as never, [{ outer: [[dx, 0], [dx + x, 0], [dx + x, y], [dx, y]].map((a, i, p) => L(a, p[(i + 1) % 4]!, 'q' + i)), holes: [] }] as never, [0, 0, z]).shape;
  const cyl = (cx: number, cy: number, z0: number, r: number, h: number) => kernel.extrude({ ...XY, origin: [0, 0, z0] } as never, [{ outer: [{ kind: 'circle', c: [cx, cy], r, source: 'c' }], holes: [] }] as never, [0, 0, h]).shape;
  const A = box(40, 30, 12);
  show('same', A, kernel.importStep(new TextEncoder().encode(kernel.exportStep(A, 'p'))).shape);
  for (const d of [1e-3, 1e-5]) show(`box moved ${d}`, A, box(40, 30, 12, d), 2 * 30 * 12 * d);
  for (const d of [1e-3, 1e-5]) show(`cylinder r+${d}`, cyl(0, 0, 0, 5, 20), cyl(0, 0, 0, 5 + d, 20), Math.PI * ((5 + d) ** 2 - 25) * 20);
  const hole = kernel.boolean('cut', A, cyl(20, 15, -1, 0.25, 14)).shape;
  show('hole d0.5 vs none', hole, A, Math.PI * 0.0625 * 12);
  for (const seed of (process.env.SEEDS ?? '2,26,10').split(',').map(Number)) {
    const s = sample(seed); const m = splineBoss(kernel, s.top, s.h);
    const occt = kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, false).shape;
    const exact = kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, true).shape;
    const back = kernel.importStep(new TextEncoder().encode(kernel.exportStep(occt, 'p'))).shape;
    show(`seed ${seed} occt(step) vs exact`, back, exact);
    if (seed === 2) { const t0 = performance.now(); const [x, y] = kernel.differenceVolumes(back, exact); log(`SD   boolean ${(x + y).toExponential(4)} in ${(performance.now() - t0).toFixed(0)} ms`); }
  }
  log('END');
}, 1_200_000);
