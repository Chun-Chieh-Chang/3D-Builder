// part-4: why the exact constant-radius arc faces (f22, f28, f135, f66 ...) are not rolling balls: every pair of neighbours at a loose tolerance, and the
// residual rows' other faces (ruled deg3x1) described
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';
const log = (m: string) => appendFileSync('scratch/ff/p4ball.log', m + String.fromCharCode(10));
it('p4', async () => {
  const kernel = await Kernel.load();
  const whole = new Uint8Array(readFileSync(join('D:/3DB實機確認', 'tmp/組合圖(R1-10226+R1-10134).STEP')));
  const part = stepAssemblyPlan(kernel, whole).prototypes.filter((p: any) => p.part)[3]!.part!.step;
  const id = kernel.importStep(part).shape;
  const topo = kernel.topology(id);
  for (const f of [22, 28, 135, 163, 66]) {
    const nb = [...new Set(topo.edges.flatMap((e) => (e.faces.includes(f) ? e.faces.filter((g) => g !== f) : [])))];
    for (let a = 0; a < nb.length; a++) for (let b = a + 1; b < nb.length; b++) {
      let r: any; try { r = kernel.rollingBall(id, f, [nb[a]!, nb[b]!], 1); } catch (e) { r = String(e).slice(0, 60); }
      log(`f${f} [${nb[a]}:${topo.faces[nb[a]!]!.surface}, ${nb[b]}:${topo.faces[nb[b]!]!.surface}] -> ${r ? JSON.stringify(r) : 'null'}`);
    }
  }
  const res = readFileSync('scratch/ff/residual.jsonl', 'utf8').trim().split(/\n/).map((l) => JSON.parse(l)).find((r) => r.label === 'part-4');
  for (const x of res.rows.filter((x: any) => x.cls.startsWith('other') && !(x.poles[0] === 3 || x.poles[1] === 3))) log(`other ${JSON.stringify(x)}`);
}, 600_000);
