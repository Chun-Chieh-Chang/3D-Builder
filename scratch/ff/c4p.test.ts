// C4-1 profile: time in Kernel.analyticFace / fileTolerance / topology during recognition of one real file (FILE), with the reader on or OFF.
import { appendFileSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { RecognizeError } from '@3db/regen';
import { recognizeText } from '../../tests/phase8/recognize-analytic-faces.kit';
const log = (m: string) => appendFileSync('scratch/ff/c4p.log', m + String.fromCharCode(10));
it('c4p', async () => {
  const kernel = await Kernel.load();
  const solver = await PlaneGcsSolver.create();
  const prof: Record<string, { n: number; ms: number }> = {};
  for (const name of ['analyticFace', 'fileTolerance', 'topology', 'sectionCurves', 'surfaceDeviation', 'massProps', 'rollingBall', 'sharpEdge', 'smoothEdges', 'deleteFaces']) {
    const real = (kernel as any)[name].bind(kernel);
    (kernel as any)[name] = (...a: any[]) => {
      if (process.env.OFF && name === 'analyticFace') return null;
      const t = performance.now();
      try { return real(...a); } finally { const p = (prof[name] ??= { n: 0, ms: 0 }); p.n++; p.ms += performance.now() - t; }
    };
  }
  const text = readFileSync(`D:/3DB實機確認/${process.env.FILE}`, 'latin1');
  const t0 = performance.now();
  let out: string;
  try { await recognizeText(kernel, solver, text); out = 'rebuilt'; } catch (e) { out = `${e instanceof RecognizeError ? 'refused' : 'ERROR'} ${String((e as Error).message).slice(0, 50)}`; }
  log(`${process.env.FILE} ${process.env.OFF ? 'off' : 'on'}: ${Math.round(performance.now() - t0)}ms ${out} | ${Object.entries(prof).sort((a, b) => b[1].ms - a[1].ms).map(([k, v]) => `${k} ${v.n}× ${Math.round(v.ms)}ms`).join(', ')}`);
}, 900_000);
