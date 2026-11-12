import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';
const D = process.env.STEP_DIR!;
const TARGETS: [string, number | null, string][] = JSON.parse(process.env.TARGETS!);
it('meshes', async () => {
  const kernel = await Kernel.load();
  for (const [rel, part, name] of TARGETS) {
    let bytes = new Uint8Array(readFileSync(`${D}/${rel}`));
    if (part !== null) bytes = stepAssemblyPlan(kernel, bytes).prototypes.filter((p: any) => p.part)[part]!.part!.step;
    const imp = kernel.importStep(bytes);
    const m: any = kernel.mesh(imp.shape, { linearDeflection: 0.02, angularDeflection: 0.2 } as any);
    writeFileSync(`/tmp/${name}.mesh.json`, JSON.stringify({ positions: Array.from(m.positions ?? m.vertices), indices: Array.from(m.indices ?? m.triangles), faceRanges: m.faceRanges ?? m.faces ?? null }));
    kernel.release(imp.shape);
  }
}, 600000);
