// C4-1: simple bodies with every face converted to a B-spline (Kernel.toBSpline), through STEP, recognized with and without reading them as analytic.
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { RecognizeError } from '@3db/regen';
import { recognizeStep, XY } from '../../tests/phase8/recognize-rolling-ball.kit';
const log = (m: string) => { appendFileSync('scratch/ff/c4f.log', m + String.fromCharCode(10)); };
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
const rect = (w: number, h: number, x = 0, y = 0) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map((a, i, p) => L(a, p[(i + 1) % 4]!, 'q' + i));
it('c4f', async () => {
  const kernel = await Kernel.load(); const solver = await PlaneGcsSolver.create();
  const circle = (c: number[], r: number) => [{ kind: 'circle', c, r, source: 'c' }];
  const bodies: Record<string, () => number> = {
    box: () => kernel.extrude(XY as never, [{ outer: rect(40, 30), holes: [] }] as never, [0, 0, 12]).shape as never,
    plateHole: () => kernel.extrude(XY as never, [{ outer: rect(40, 30), holes: [circle([20, 15], 6)] }] as never, [0, 0, 12]).shape as never,
    disc: () => kernel.extrude(XY as never, [{ outer: circle([0, 0], 15), holes: [] }] as never, [0, 0, 8]).shape as never,
    bossOnPlate: () => kernel.boolean('fuse', kernel.extrude(XY as never, [{ outer: rect(40, 30), holes: [] }] as never, [0, 0, 5]).shape, kernel.extrude({ ...XY, origin: [0, 0, 4] } as never, [{ outer: circle([20, 15], 7), holes: [] }] as never, [0, 0, 9]).shape).shape as never,
  };
  for (const [name, make] of Object.entries(bodies)) {
    const s = make() as never; const b = kernel.toBSpline(s);
    const t = kernel.topology(b);
    const kinds: Record<string, number> = {}; t.faces.forEach((f) => (kinds[f.surface] = (kinds[f.surface] ?? 0) + 1));
    const ek: Record<string, number> = {}; t.edges.forEach((e) => (ek[e.curve] = (ek[e.curve] ?? 0) + 1));
    for (const [label, shape] of [['plain', s], ['bspline', b]] as const) {
      const t0 = performance.now();
      try { const r = await recognizeStep(kernel, solver, shape); log(`${name} ${label}: rebuilt ${JSON.stringify(r.report.features)} vol ${r.report.volumeError.toExponential(1)} diff ${r.report.difference.toExponential(1)} ${Math.round(performance.now() - t0)}ms`); }
      catch (e) { log(`${name} ${label}: ${e instanceof RecognizeError ? 'refused' : 'ERROR'} ${String((e as Error).message).slice(0, 200)}`); }
    }
    log(`  faces ${JSON.stringify(kinds)} edges ${JSON.stringify(ek)}`);
  }
}, 600_000);
