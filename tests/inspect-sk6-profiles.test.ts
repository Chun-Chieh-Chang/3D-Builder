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

it('inspects sketch6 solved profiles', () => {
  const doc = parsePart(readFileSync('scratch/real-part1.json', 'utf8').replace(/^\uFEFF/, ''));
  const sk4 = doc.features.find((f) => f.id === 'sketch4');
  if (sk4 && sk4.type === 'sketch') {
    sk4.plane = { kind: 'datum', name: 'plane:front' };
  }

  const r = new Regenerator(kernel, solver, new Map()).rebuild(doc);
  const sk6Res = r.sketches.get('sketch6')!;
  console.log('sketch6 regions count:', sk6Res.profiles.regions.length);
  sk6Res.profiles.regions.forEach((region, ri) => {
    console.log(`Region ${ri} outer segments (${region.outer.length}):`);
    region.outer.forEach((seg, si) => {
      if (seg.kind === 'line') {
        console.log(`  seg ${si} [line ${seg.source}]: a=[${seg.a[0].toFixed(3)}, ${seg.a[1].toFixed(3)}], b=[${seg.b[0].toFixed(3)}, ${seg.b[1].toFixed(3)}]`);
      } else if (seg.kind === 'arc') {
        console.log(`  seg ${si} [arc ${seg.source}]: from=[${seg.from[0].toFixed(3)}, ${seg.from[1].toFixed(3)}], to=[${seg.to[0].toFixed(3)}, ${seg.to[1].toFixed(3)}], c=[${seg.c[0].toFixed(3)}, ${seg.c[1].toFixed(3)}], r=${seg.r.toFixed(3)}`);
      }
    });
  });
});
