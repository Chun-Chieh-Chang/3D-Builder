// A box whose one corner is an exact elliptical quarter (rational quadratic, semi-axes a and a+e), tangent to both walls: near a round but not one.
// Before the 1e-3·r nomination it was an exact spline wall of an extrusion; is it still recognized, or now nominated as a round and refused?
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { recognizeStep } from '../../tests/phase8/recognize-rolling-ball.kit';
const log = (m: string) => appendFileSync('scratch/ff/ellcorner.log', m + String.fromCharCode(10));
it('ellcorner', async () => {
  const kernel = await Kernel.load(); const solver = await PlaneGcsSolver.create();
  const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as any;
  for (const [a, e] of [[2, 0], [2, 2e-4], [2, 1e-3], [2, 3e-3], [2, 2e-2]] as const) {
    const b = a + e; const w = Math.SQRT1_2;
    const segs = [
      { kind: 'line', a: [0, 0], b: [40, 0], source: 'l0' },
      { kind: 'line', a: [40, 0], b: [40, 30 - b], source: 'l1' },
      { kind: 'spline', points: [[40, 30 - b], [40 - a, 30]], closed: false, source: 'e', nurbs: { poles: [[40, 30 - b], [40, 30], [40 - a, 30]], degree: 2, knots: [0, 1], mults: [3, 3], weights: [1, w, 1] } },
      { kind: 'line', a: [40 - a, 30], b: [0, 30], source: 'l2' },
      { kind: 'line', a: [0, 30], b: [0, 0], source: 'l3' },
    ];
    let msg: string;
    try {
      const s = kernel.extrude(XY, [{ outer: segs, holes: [] }] as any, [0, 0, 10]).shape;
      const out: any = await recognizeStep(kernel, solver, s).catch((x: unknown) => x);
      const rep = out?.report;
      msg = rep ? `ok vol ${rep.volumeError.toExponential(2)} diff ${rep.difference?.toExponential(2)} features ${JSON.stringify(rep.features)}` : `REFUSED ${String(out?.message ?? out).slice(0, 160)}`;
    } catch (x: any) { msg = `BUILD ${String(x?.message ?? x).slice(0, 100)}`; }
    log(`${process.env.TAG} a ${a} e ${e}: ${msg}`);
  }
}, 600_000);
