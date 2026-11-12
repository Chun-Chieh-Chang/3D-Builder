import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { boss, rounds } from './corner-samples';
it('corner samples: OCCT vs exact', async () => {
  const kernel = await Kernel.load(); const out: any = {};
  const cases = JSON.parse(process.env.CASES ?? '[["stadium",0.25,5,0],["lens",0.25,5,0],["stadium",0.25,5,15],["lens",0,0,0]]');
  for (const [kind, tilt, draft, cy] of cases) for (const r of [0.381, 1.5]) {
    const key = `${kind} tilt=${tilt} draft=${draft} cy=${cy} r=${r}`;
    try {
      const { shape, edges } = boss(kernel, kind, tilt, draft, cy);
      const t0 = performance.now(); const o = kernel.fillet(shape, edges, r, undefined, undefined, false); const t1 = performance.now(); const e = kernel.fillet(shape, edges, r, undefined, undefined, true); const t2 = performance.now();
      const ro = rounds(kernel, o, r), re = rounds(kernel, e, r);
      const v0 = kernel.massProps(o.shape).volume, v1 = kernel.massProps(e.shape).volume;
      out[key] = { log: (kernel as any).exactRoundLog.map((x: any) => `${x.contour}:${x.outcome}${x.detail ? " " + x.detail : ""}`), edges: edges.length, ms: [Math.round(t1 - t0), Math.round(t2 - t1)], valid: kernel.isValid(e.shape), maxTol: [(kernel as any).maxTolerance((kernel as any).get(o.shape)), (kernel as any).maxTolerance((kernel as any).get(e.shape))], dV: (v1 - v0) / v0, occt: ro.map((x) => `${x.i}:${x.surface}:${x.sup.length}:${x.dev.toExponential(1)}`), exact: re.map((x) => `${x.i}:${x.surface}:${x.sup.length}:${x.dev.toExponential(1)}`) };
    } catch (err) { out[key] = String(err).slice(0, 200); }
    writeFileSync(process.env.OUT!, JSON.stringify(out, null, 1));
  }
}, 600000);
