import { readFileSync } from 'node:fs';
import { beforeAll, it } from 'vitest';
import { parsePart } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

it('inspects cut2 tool solid and wires', () => {
  const doc = parsePart(readFileSync('scratch/real-part1.json', 'utf8').replace(/^\uFEFF/, ''));
  const sk4 = doc.features.find((f) => f.id === 'sketch4');
  if (sk4 && sk4.type === 'sketch') {
    sk4.plane = { kind: 'datum', name: 'plane:front' };
  }

  // 取得 cut2 之前的本體 (cut1 之後)
  const docBeforeCut2 = JSON.parse(JSON.stringify(doc));
  docBeforeCut2.features = docBeforeCut2.features.filter((f: any) => f.id !== 'cut2');
  const rBefore = new Regenerator(kernel, solver, new Map()).rebuild(docBeforeCut2);
  const bBefore = rBefore.body!;
  console.log('Body before cut2 has faces:', bBefore.topology.faces.length);

  // 觀察 cut2 到底切了什麼
  // cut2 是 extrude cut，我們如果把 cut2 的深度設為 1.2 mm，但等等！
  // 凸緣的高度精確是多少？
  // 讓我們查 sketch4 中凸緣的高度！
  const sk4Entities = (doc.features.find((f) => f.id === 'sketch4') as any).entities;
  const sk4Constraints = (doc.features.find((f) => f.id === 'sketch4') as any).constraints;
  console.log('sketch4 constraints with distanceY or distance:', 
    sk4Constraints.filter((c: any) => c.type === 'distance' || c.type === 'distanceY')
  );
});
