// Calibrating ROLLING_BALL_TOLERANCE on the fixed code: for seeds FROM..TO, the round's rollingBall deviation (gate off, tol 1) on the STEP round trip,
// split by whether the kernel's round was exact (and its build deviation) or OCCT's.
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { sample, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';
it('dev', async () => {
  const kernel = await Kernel.load(); const k = kernel as any;
  const rows: string[] = [];
  for (let seed = Number(process.env.FROM ?? 1); seed <= Number(process.env.TO ?? 50); seed++) {
    const s = sample(seed); const m = splineBoss(kernel, s.top, s.h);
    let made: any; try { made = kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, true).shape; } catch { rows.push(`DEV ${seed} notMade`); continue; }
    const log = k.exactRoundLog.map((x: any) => `${x.outcome}${/dev ([\d.e-]+)/.exec(x.detail ?? '')?.[1] ? ' build ' + /dev ([\d.e-]+)/.exec(x.detail)![1] : ''}`).join(',');
    const back = kernel.importStep(new TextEncoder().encode(kernel.exportStep(made, 'p'))).shape;
    const t = kernel.topology(back); const sm = kernel.smoothEdges(back, t.edges.map((_, i) => i));
    const nb = (f: number) => [...new Set(t.edges.flatMap((e, x) => (sm[x] && e.faces.includes(f) ? e.faces.filter((q) => q !== f) : [])))];
    const devs = t.faces.flatMap((f, i) => (f.surface !== 'plane' && f.surface !== 'surfaceofextrusion' && nb(i).length === 2 ? [kernel.rollingBall(back, i, nb(i) as [number, number], 1)] : []));
    rows.push(`DEV ${seed} r ${s.radius} ${log} :: ${devs.map((d) => (d ? `r ${d.radius.toPrecision(6)} dev ${d.deviation.toExponential(2)}` : 'null')).join(' | ')}`);
    kernel.release(back); kernel.release(made); kernel.release(m.shape);
  }
  console.log(rows.join('\n'));
}, 1_200_000);
