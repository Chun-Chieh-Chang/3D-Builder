import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { parsePart } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';

it('traces where edge 21 came from after cut2', async () => {
  const k = await Kernel.load();
  const s = await PlaneGcsSolver.create();
  const doc = parsePart(readFileSync('scratch/real-part1.json', 'utf8').replace(/^\uFEFF/, ''));

  const sk4 = doc.features.find((f) => f.id === 'sketch4');
  sk4.plane = { kind: 'datum', name: 'plane:front' };

  const r = new Regenerator(k, s, new Map()).rebuild(doc);
  const b = r.body!;

  console.log('Edge 21 in b:', b.topology.edges[21]);
  console.log('Edge 21 name:', b.names.edges[21]);
});
