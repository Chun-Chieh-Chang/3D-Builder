import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { parsePart } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';

it('inspects solved coordinates of sketch6', async () => {
  const s = await PlaneGcsSolver.create();
  const doc = parsePart(readFileSync('scratch/real-part1.json', 'utf8').replace(/^\uFEFF/, ''));
  const sk6 = doc.features.find((f) => f.id === 'sketch6') as any;

  const sol = s.solve(sk6);
  console.log('Solver status:', sol.status);
  console.log('geometry size:', sol.geometry.size);
  for (const [k, v] of sol.geometry.entries()) {
    console.log(`${k}:`, v);
    break;
  }
  console.log('=== SOLVED POINTS OF SKETCH6 ===');
  ['p17', 'p20', 'p21', 'p22', 'p25', 'p26', 'p29', 'p30', 'p31', 'p32', 'p33', 'p34', 'p35', 'p36'].forEach((pid) => {
    const pt = sol.geometry?.get(pid) as any;
    console.log(`${pid}: [${pt?.p?.[0]?.toFixed(6)}, ${pt?.p?.[1]?.toFixed(6)}]`);
  });
});
