// part-4: which analytic faces point along the slanted rulings of f173/f174, and is every odd face a wall along some candidate direction?
import { appendFileSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';
const log = (m: string) => appendFileSync('scratch/ff/p4dir.log', m + String.fromCharCode(10));
it('p4dir', async () => {
  const kernel = await Kernel.load();
  const whole = new Uint8Array(readFileSync('D:/3DB實機確認/tmp/組合圖(R1-10226+R1-10134).STEP'));
  const id = kernel.importStep(stepAssemblyPlan(kernel, whole).prototypes.filter((p: any) => p.part)[3]!.part!.step).shape;
  const topo = kernel.topology(id);
  const dirs = new Map<string, string[]>();
  topo.faces.forEach((f, i) => {
    const g: any = f.geometry; if (!g) return;
    const v = g.type === 'plane' ? g.normal : g.axis; if (!v) return;
    let c = v.map((x: number) => (Math.abs(x) < 1e-9 ? 0 : x)); const s = c.find((x: number) => x !== 0)! < 0 ? -1 : 1; c = c.map((x: number) => x * s);
    const key = c.map((x: number) => x.toFixed(5)).join(',');
    dirs.set(key, [...(dirs.get(key) ?? []), `f${i}${g.type[0]}`]);
  });
  for (const [k, v] of dirs) log(`(${k}) ${v.length}: ${v.slice(0, 12).join(' ')}`);
  for (const f of [173, 174, 191, 270, 178, 271, 220, 221]) log(`f${f} ${topo.faces[f]!.surface} ${JSON.stringify(topo.faces[f]!.geometry)?.slice(0, 200)}`);
  for (const f of [173, 174]) for (const d of [[0.7071067811865476, -0.7071067811865476, 0], [-0.7071067811865476, -0.7071067811865476, 0], [0.7076, -0.7066, 0]]) log(`f${f} along ${d.map((x) => x.toFixed(4))}: ext ${kernel.faceExtrudedAlong(id, f, d as any)} ruled ${kernel.faceRuledAlong(id, f, d as any)}`);
}, 600_000);
