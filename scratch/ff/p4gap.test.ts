// part-4 round-like faces: their joint gap (fileTolerance) against their rolling-ball deviation on the analytic pair
import { appendFileSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';
const log = (m: string) => appendFileSync('scratch/ff/p4gap.log', m + String.fromCharCode(10));
it('p4gap', async () => {
  const kernel = await Kernel.load();
  const whole = new Uint8Array(readFileSync('D:/3DB實機確認/tmp/組合圖(R1-10226+R1-10134).STEP'));
  const id = kernel.importStep(stepAssemblyPlan(kernel, whole).prototypes.filter((p: any) => p.part)[3]!.part!.step).shape;
  const ft = kernel.fileTolerance(id); const topo = kernel.topology(id);
  log(`part-4 faces with gap ${ft.count}/${topo.faces.length} max ${ft.max.toExponential(2)} volume ${ft.volume.toExponential(2)} area ${ft.area.toExponential(2)}`);
  for (const [f, s1, s2] of [[22, 168, 190], [28, 179, 167], [41, 170, 213], [47, 201, 169], [135, 170, 211], [136, 203, 169], [163, 168, 188], [164, 181, 167], [66, 282, 244]] as const) {
    const b = kernel.rollingBall(id, f, [s1, s2], 1);
    const eg = topo.edges.map((e, k) => ({ e, k })).filter(({ e }) => e.faces.includes(f)).map(({ e, k }) => `${e.faces.find((g) => g !== f)}:${ft.edges[k]!.toExponential(1)}`);
    log(`f${f} gap ${ft.faces[f]!.toExponential(2)} ballDev ${b?.deviation.toExponential(2)} ratio ${((b?.deviation ?? 0) / ft.faces[f]!).toFixed(2)} edges ${eg.join(' ')}`);
  }
}, 600_000);
