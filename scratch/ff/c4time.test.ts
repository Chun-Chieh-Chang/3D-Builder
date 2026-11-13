// C4-1: where rolling-ball fuzz seed 46 spends its time with the analytic-face reader on: substitutions, attempts, fine-volume integrals.
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { RecognizeError } from '@3db/regen';
import { recognizeStep, sample, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';
const log = (m: string) => appendFileSync('scratch/ff/c4time.log', m + String.fromCharCode(10));
it('c4time', async () => {
  const seed = +(process.env.SEED ?? 46);
  const kernel = await Kernel.load();
  const solver = await PlaneGcsSolver.create();
  const real = (kernel as any).analyticFace?.bind(kernel) ?? (() => null);
  const hits: string[] = [];
  (kernel as any).analyticFace = (s: any, f: number, tol: number) => {
    const r = process.env.OFF ? null : real(s, f, tol);
    hits.push(`${f}:${r ? r.geometry.type + ' ' + r.deviation.toExponential(1) : '-'}@${tol.toExponential(0)}`);
    return r;
  };
  const mp = kernel.massProps.bind(kernel);
  const fine = { n: 0, ms: 0 }, plain = { n: 0, ms: 0 };
  kernel.massProps = (id, o = {}) => {
    const t = performance.now();
    try { return mp(id, o); } finally { const b = o.eps !== undefined ? fine : plain; b.n++; b.ms += performance.now() - t; }
  };
  const s = sample(seed);
  const m = splineBoss(kernel, s.top, s.h);
  const shape = kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, true).shape;
  const t1 = performance.now();
  let out: string;
  try {
    const r = await recognizeStep(kernel, solver, shape);
    out = `rebuilt ${JSON.stringify(r.report.features)} diff ${r.report.difference.toExponential(1)}`;
  } catch (e) {
    out = `${e instanceof RecognizeError ? 'refused' : 'ERROR'} ${String((e as Error).message).slice(0, 60)}`;
  }
  log(`seed ${seed} ${process.env.TAG ?? (process.env.OFF ? 'off' : 'on')}: recognize ${Math.round(performance.now() - t1)}ms | analyticFace ${hits.join(' ')} | fine massProps ${fine.n} ${Math.round(fine.ms)}ms, plain ${plain.n} ${Math.round(plain.ms)}ms | ${out}`);
}, 1_800_000);
