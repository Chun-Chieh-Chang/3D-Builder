import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';
it('neighbours', async () => {
  const kernel = await Kernel.load();
  const [rel, part] = JSON.parse(process.env.TARGET!);
  let bytes = new Uint8Array(readFileSync(`${process.env.STEP_DIR}/${rel}`));
  if (part !== null) bytes = stepAssemblyPlan(kernel, bytes).prototypes.filter((p: any) => p.part)[part]!.part!.step;
  const imp = kernel.importStep(bytes);
  const t = kernel.topology(imp.shape);
  const smooth = kernel.smoothEdges(imp.shape, t.edges.map((_, i) => i));
  const want = JSON.parse(process.env.FACES!) as number[];
  const out: any = {};
  const g = (i: number) => { const f = t.faces[i]!; const x: any = f.geometry; return `${i}:${f.surface}${x?.type === 'torus' ? `(R${x.major.toFixed(3)} r${x.minor.toFixed(3)})` : x?.type === 'cylinder' ? `(r${x.radius.toFixed(3)})` : x?.type === 'cone' ? '' : ''} A=${f.area.toFixed(3)}`; };
  for (const fi of want) out[g(fi)] = t.edges.flatMap((e, k) => (e.faces.includes(fi) ? [`e${k} ${e.curve} L=${e.length.toFixed(3)} ${smooth[k] ? 'smooth' : 'SHARP'} v=${e.vertices.join(',')} -> ${e.faces.filter((n) => n !== fi).map(g).join(' ')}`] : []));
  writeFileSync(process.env.OUT!, JSON.stringify(out, null, 1));
}, 600000);
