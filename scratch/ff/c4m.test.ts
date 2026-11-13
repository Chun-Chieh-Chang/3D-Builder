// C4: an analytic round on a drafted support (a torus between a plane and a cone) on a part that also has a free round: before, no closed-form sharp edge → refused.
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { RecognizeError } from '@3db/regen';
import { recognizeStep, splineBoss, XY } from '../../tests/phase8/recognize-rolling-ball.kit';
const log = (m: string) => { appendFileSync('scratch/ff/c4m.log', m + String.fromCharCode(10)); };
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
it('c4m', async () => {
  const kernel = await Kernel.load(); const solver = await PlaneGcsSolver.create();
  for (const variant of ['cone', 'cylinder'] as const) {
    const m = splineBoss(kernel);
    const withRound = kernel.fillet(m.shape, m.edges, 1, undefined, undefined, true).shape;
    // a tapered (or straight) round boss on the plate's top (z = 0), away from the spline boss
    const top = variant === 'cone' ? 2.2 : 3;
    const tr = { outer: [L([0, -1], [3, -1], 'a'), L([3, -1], [3, 0], 'a2'), L([3, 0], [top, 6], 'b'), L([top, 6], [0, 6], 'c'), L([0, 6], [0, -1], 'd')], holes: [] };
    const frame = { origin: [12, 10, 10], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] };
    const boss = kernel.revolve(frame as never, [tr] as never, { origin: [12, 10, 10], dir: [0, 0, 1] }, 2 * Math.PI).shape;
    const fused = kernel.boolean('fuse', withRound, boss).shape;
    const t = kernel.topology(fused);
    const foot = t.edges.flatMap((e, i) => (e.geometry?.type === 'circle' && Math.abs(e.mid[2] - 10) < 1e-9 && Math.abs(e.geometry.radius - 3) < 1e-9 ? [i] : []));
    log(`${variant}: foot edges ${foot.length}`);
    const s = kernel.fillet(fused, foot, 0.8).shape;
    const kinds: Record<string, number> = {}; kernel.topology(s).faces.forEach((f) => (kinds[f.geometry?.type ?? 'odd:' + f.surface] = (kinds[f.geometry?.type ?? 'odd:' + f.surface] ?? 0) + 1));
    log(`  faces ${JSON.stringify(kinds)}`);
    for (const noSharp of [false, true]) {
      const real = kernel.sharpEdge.bind(kernel); let calls = 0;
      // control: the sharp edge only asked for rounds with no simple surface, as before
      (kernel as any).sharpEdge = (sh: any, f: number, sup: any, n?: number) => { calls++; return noSharp && kernel.topology(sh).faces[f]!.geometry ? null : real(sh, f, sup, n); };
      try { const r = await recognizeStep(kernel, solver, s); log(`  ${noSharp ? 'control' : 'now'}: rebuilt ${JSON.stringify(r.report.features)} vol ${r.report.volumeError.toExponential(1)} diff ${r.report.difference.toExponential(1)} calls ${calls}`); }
      catch (e) { log(`  ${noSharp ? 'control' : 'now'}: ${e instanceof RecognizeError ? 'refused' : 'ERROR'} ${String((e as Error).message).slice(0, 200)} calls ${calls}`); }
      finally { (kernel as any).sharpEdge = real; }
    }
  }
}, 600_000);
