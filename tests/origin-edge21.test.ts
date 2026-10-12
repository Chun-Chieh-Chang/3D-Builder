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

it('finds where Edge 21 comes from', () => {
  const doc = parsePart(readFileSync('scratch/real-part1.json', 'utf8').replace(/^\uFEFF/, ''));
  const sk4 = doc.features.find((f) => f.id === 'sketch4');
  if (sk4 && sk4.type === 'sketch') {
    sk4.plane = { kind: 'datum', name: 'plane:front' };
  }

  // 1. 只執行 revolve1
  const doc1 = JSON.parse(JSON.stringify(doc));
  doc1.features = doc1.features.slice(0, 2);
  const r1 = new Regenerator(kernel, solver, new Map()).rebuild(doc1);
  console.log('revolve1 body edges:', r1.body!.topology.edges.length);
  r1.body!.topology.edges.forEach((e, i) => {
    if (e.curve === 'line') console.log(`  revolve1 line edge ${i}: len=${e.length?.toFixed(3)}, mid=[${e.mid?.map(v=>v.toFixed(3))}], name=${r1.body!.names.edges[i]}`);
  });

  // 2. 執行到 cut1
  const doc2 = JSON.parse(JSON.stringify(doc));
  doc2.features = doc2.features.slice(0, 4);
  const r2 = new Regenerator(kernel, solver, new Map()).rebuild(doc2);
  console.log('cut1 body edges:', r2.body!.topology.edges.length);
  r2.body!.topology.edges.forEach((e, i) => {
    if (e.curve === 'line') console.log(`  cut1 line edge ${i}: len=${e.length?.toFixed(3)}, mid=[${e.mid?.map(v=>v.toFixed(3))}], name=${r2.body!.names.edges[i]}`);
  });

  // 3. 執行到 cut2
  const doc3 = JSON.parse(JSON.stringify(doc));
  const r3 = new Regenerator(kernel, solver, new Map()).rebuild(doc3);
  console.log('cut2 body edges:', r3.body!.topology.edges.length);
  r3.body!.topology.edges.forEach((e, i) => {
    if (e.curve === 'line' && (e.mid?.[0]?.toFixed(2) === '1.35' || e.mid?.[0]?.toFixed(2) === '-1.35')) {
      console.log(`  cut2 line edge ${i}: len=${e.length?.toFixed(3)}, mid=[${e.mid?.map(v=>v.toFixed(3))}], name=${r3.body!.names.edges[i]}, faces=${e.faces}`);
    }
  });
});
