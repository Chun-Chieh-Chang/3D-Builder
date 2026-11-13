// C4-1, run with the gate removed (c4n-run.mjs pattern): a nearly flat spline wall (sag s) — at which tolerances does OCCT propose a plane that is
// farther than the tolerance from the face?
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
const log = (m: string) => appendFileSync('scratch/ff/c4o.log', m + String.fromCharCode(10));
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
it('c4o', async () => {
  const kernel = await Kernel.load();
  const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
  for (const sag of [1e-3, 3e-3, 1e-2, 3e-2]) for (const n of [3, 4, 5]) {
    // the top of the outline: n points from (30, 20) to (0, 20), bulging up by sag in the middle
    const pts = Array.from({ length: n }, (_, i) => { const x = 30 * (1 - i / (n - 1)); return [x, 20 + sag * Math.sin((Math.PI * i) / (n - 1))]; });
    const s = kernel.extrude(XY as never, [{ outer: [L([0, 0], [30, 0], 'a'), L([30, 0], [30, 20], 'b'), { kind: 'spline', points: pts, source: 'c' }, L([0, 20], [0, 0], 'd')], holes: [] }] as never, [0, 0, 8]).shape;
    const i = kernel.topology(s).faces.findIndex((f) => !f.geometry);
    const row: string[] = [];
    for (let k = 0; k <= 24; k++) {
      const tol = sag * 10 ** (-1.5 + k / 12);
      const r = kernel.analyticFace(s, i, tol);
      if (r && r.deviation > tol) row.push(`tol ${tol.toExponential(3)} -> ${r.geometry.type} measured ${r.deviation.toExponential(3)} (${(r.deviation / tol).toFixed(3)}x)`);
    }
    log(`sag ${sag} n ${n}: ${row.length ? row.join(' ; ') : 'none over'}`);
    kernel.release(s);
  }
}, 900_000);
