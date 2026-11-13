// Why C2.10 finds no edge for SEEDS (comma list): every distancesToEdge call recognition makes, per edge: points on it (<=1e-6), nulls, the nearest
// distance; then for each point not covered, its least distance over all asked edges and whether it was null on them.
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { recognizeStep, sample, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';
it('edge', async () => {
  const kernel = await Kernel.load(); const solver = await PlaneGcsSolver.create();
  const orig = kernel.distancesToEdge.bind(kernel);
  let calls: { edge: number; ds: (number | null)[] }[] = [];
  (kernel as any).distancesToEdge = (s: any, e: number, p: any) => { const ds = orig(s, e, p); calls.push({ edge: e, ds }); return ds; };
  for (const seed of (process.env.SEEDS ?? '51').split(',').map(Number)) {
    const s = sample(seed); const m = splineBoss(kernel, s.top, s.h);
    const made = kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, true);
    const log = (kernel as any).exactRoundLog.map((x: any) => x.outcome).join(',');
    calls = [];
    let res = '';
    try { const r = await recognizeStep(kernel, solver, made.shape); res = `ok ${JSON.stringify(r.report.features)} dV ${r.report.volumeError}`; } catch (e: any) { res = `refused ${String(e.message).slice(0, 80)}`; }
    console.log(`RBE seed ${seed} r=${s.radius} round=${log} ${res} calls=${calls.length}`);
    const n = calls[0]?.ds.length ?? 0;
    for (const c of calls) {
      const on = c.ds.filter((d) => d !== null && d <= 1e-6).length, nul = c.ds.filter((d) => d === null).length;
      const near = Math.min(...c.ds.filter((d): d is number => d !== null));
      console.log(`RBE   edge ${c.edge}: on ${on}/${n} null ${nul} nearest ${near.toExponential(2)} onIdx ${c.ds.map((d, k) => (d !== null && d <= 1e-6 ? k : -1)).filter((k) => k >= 0).join(' ')}`);
    }
    for (let k = 0; k < n; k++) {
      if (calls.some((c) => { const d = c.ds[k]; return d !== null && d !== undefined && d <= 1e-6; })) continue;
      console.log(`RBE   point ${k} uncovered: ${calls.map((c) => `${c.edge}:${c.ds[k] === null ? 'null' : c.ds[k]!.toExponential(2)}`).join(' ')}`);
    }
  }
}, 900_000);
