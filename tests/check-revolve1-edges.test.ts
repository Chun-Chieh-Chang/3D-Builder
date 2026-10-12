import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { parsePart } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';

it('inspects revolve1 edges before any cut', async () => {
  const k = await Kernel.load();
  const s = await PlaneGcsSolver.create();
  const doc = parsePart(readFileSync('scratch/real-part1.json', 'utf8').replace(/^\uFEFF/, ''));

  const sk4 = doc.features.find((f) => f.id === 'sketch4');
  sk4.plane = { kind: 'datum', name: 'plane:front' };

  // 只要 revolve1
  const docRev = JSON.parse(JSON.stringify(doc));
  docRev.features = docRev.features.filter((f: any) => f.id === 'sketch4' || f.id === 'revolve1');

  const r = new Regenerator(k, s, new Map()).rebuild(docRev);
  const b = r.body!;
  console.log('=== ALL EDGES OF REVOLVE1 ===');
  b.topology.edges.forEach((e, i) => {
    console.log(`Edge ${i}: curve=${e.curve}, mid=[${e.mid?.map(v=>v.toFixed(3))}], len=${e.length?.toFixed(3)}, name=${b.names.edges[i]}`);
  });
});
