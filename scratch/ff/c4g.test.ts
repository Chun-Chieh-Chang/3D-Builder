// C4-1: how well OCCT integrates the volume of a disc whose faces are B-splines, by eps, before and after STEP.
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { XY } from '../../tests/phase8/recognize-rolling-ball.kit';
const log = (m: string) => { appendFileSync('scratch/ff/c4g.log', m + String.fromCharCode(10)); };
it('c4g', async () => {
  const kernel = await Kernel.load();
  const s = kernel.extrude(XY as never, [{ outer: [{ kind: 'circle', c: [0, 0], r: 15, source: 'c' }], holes: [] }] as never, [0, 0, 8]).shape;
  const truth = Math.PI * 225 * 8;
  const b = kernel.toBSpline(s);
  const viaStep = kernel.importStep(new TextEncoder().encode(kernel.exportStep(b, 'p'))).shape;
  for (const [name, id] of [['analytic', s], ['bspline', b], ['bspline via STEP', viaStep]] as const) {
    const row = [undefined, 1e-6, 1e-8, 1e-10].map((eps) => { const t0 = performance.now(); const v = kernel.massProps(id, eps === undefined ? {} : { eps }).volume; return `eps ${eps ?? 'default'}: rel err ${((v - truth) / truth).toExponential(2)} (${Math.round(performance.now() - t0)}ms)`; });
    log(`${name}: ${row.join(' | ')} | exact ${((kernel.massPropsExact(id).volume - truth) / truth).toExponential(2)}`);
  }
  const t = kernel.topology(viaStep); log(`faces ${t.faces.map((f) => f.surface).join(',')} analytic ${t.faces.map((_, i) => { const a = kernel.analyticFace(viaStep, i, 1e-6); return a ? `${a.geometry.type}:${a.deviation.toExponential(1)}` : '-'; }).join(' ')}`);
}, 600_000);
