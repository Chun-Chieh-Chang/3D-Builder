// Recognizing part-3's B regions, probe 3: what the corner faces f152 and f154 are. Kernel.rollingBall against each pair of neighbours with no threshold
// (c5d kept only deviation < 1e-2), radius and deviation printed; with the face's area, τ, and the neighbours' radii for comparison. Product code untouched.
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { part3 } from './c5a.test';

const log = (m: string) => appendFileSync('scratch/ff/c8.log', m + String.fromCharCode(10));

it('c8c', async () => {
  const kernel = await Kernel.load();
  const id = part3(kernel);
  const topo = kernel.topology(id);
  const tau = kernel.fileTolerance(id).faces;
  const adjOf = (f: number) => [...new Set(topo.edges.filter((e) => e.faces.includes(f)).flatMap((e) => e.faces))].filter((x) => x !== f);
  log('== c8c corner faces');
  for (const f of [152, 154, 150, 81]) {
    const nb = adjOf(f);
    const rows: string[] = [];
    for (let x = 0; x < nb.length; x++) for (let y = x + 1; y < nb.length; y++) {
      let ball: any = null;
      try { ball = kernel.rollingBall(id, f, [nb[x]!, nb[y]!], Infinity); } catch (e) { rows.push(`f${nb[x]}+f${nb[y]} threw ${(e as Error).message.slice(0, 60)}`); continue; }
      rows.push(ball ? `f${nb[x]}+f${nb[y]} r ${ball.radius.toFixed(4)} dev ${ball.deviation.toExponential(1)}` : `f${nb[x]}+f${nb[y]} none`);
    }
    log(`  f${f} area ${topo.faces[f]!.area.toFixed(3)} τ ${(tau[f] ?? 0).toExponential(1)} adj ${nb.join(',')}: ${rows.join(' ; ')}`);
  }
}, 600_000);
