import { beforeAll, it } from 'vitest';
import { parsePart } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
// @ts-ignore
import { cat } from '../scripts/3dbx.mjs';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

it('tests actual real part file rebuild', () => {
  const jsonStr = cat('D:/3DB實機確認/C3C6檢具/零件1.3dbx');
  const doc = parsePart(jsonStr);
  console.log('Doc loaded, features count:', doc.features.length);

  const r = new Regenerator(kernel, solver, new Map()).rebuild(doc);
  console.log('Rebuild result:');
  console.log('Body valid:', r.body ? kernel.check(r.body.shape).valid : 'no body');
  r.features.forEach((f) => {
    if (f.error || f.unresolved?.length) {
      console.log(`Feature ${f.id} error:`, f.error, f.message, f.unresolved);
    }
  });
});
