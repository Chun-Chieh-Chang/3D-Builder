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

it('inspects Face 8 and adjacent edges', () => {
  const doc = parsePart(readFileSync('scratch/real-part1.json', 'utf8').replace(/^\uFEFF/, ''));
  const sk4 = doc.features.find((f) => f.id === 'sketch4');
  if (sk4 && sk4.type === 'sketch') {
    sk4.plane = { kind: 'datum', name: 'plane:front' };
  }

  const r = new Regenerator(kernel, solver, new Map()).rebuild(doc);
  const b = r.body!;
  const f8 = b.topology.faces[8]!;
  console.log('Face 8 info:', {
    surface: f8.surface,
    area: f8.area,
    center: f8.center,
  });

  // Face 8 包含哪些邊？
  const edgesOfF8 = b.topology.edges
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.faces?.includes(8));
  console.log('Face 8 has', edgesOfF8.length, 'edges:');
  edgesOfF8.forEach(({ e, i }) => {
    console.log(`  Edge ${i} [${b.names.edges[i]}]: curve=${e.curve}, len=${e.length?.toFixed(4)}, mid=[${e.mid?.map(v=>v.toFixed(3))}]`);
  });
});
