// C4-1: Kernel.analyticFace on part-4's odd faces at several tolerances, against the file tolerance of each.
import { appendFileSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';
const log = (m: string) => appendFileSync('scratch/ff/c4e.log', m + String.fromCharCode(10));
it('c4e', async () => {
  const kernel = await Kernel.load();
  const whole = new Uint8Array(readFileSync('D:/3DB實機確認/組合圖(R1-10226+R1-10134).STEP'));
  for (const part of [2, 3]) {
    const id = kernel.importStep(stepAssemblyPlan(kernel, whole).prototypes.filter((p: any) => p.part)[part]!.part!.step).shape;
    const topo = kernel.topology(id); const tau = kernel.fileTolerance(id).faces;
    let n6 = 0, nt = 0, odd = 0;
    topo.faces.forEach((f, i) => {
      if (f.geometry) return; odd++;
      const a = kernel.analyticFace(id, i, 1e-6); const b = kernel.analyticFace(id, i, Math.max(1e-6, tau[i] ?? 0)); const c = kernel.analyticFace(id, i, 1e-2);
      if (a) n6++; if (b) nt++;
      if (part === 3 && (b || [11, 171, 172, 173, 174].includes(i))) log(`p${part + 1} f${i} ${f.surface} tau ${(tau[i] ?? 0).toExponential(1)} @1e-6 ${a ? a.geometry.type + ' ' + a.deviation.toExponential(1) : '-'} @tau ${b ? b.geometry.type + ' ' + b.deviation.toExponential(1) : '-'} @1e-2 ${c ? c.geometry.type + ' ' + c.deviation.toExponential(1) : '-'}`);
    });
    log(`part-${part + 1}: odd ${odd}, analytic within 1e-6: ${n6}, within max(1e-6, tau): ${nt}`);
  }
}, 600_000);
