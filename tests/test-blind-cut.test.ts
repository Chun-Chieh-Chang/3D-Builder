import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { parsePart } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';

it('tests blind cut2 of depth 1.2 mm', async () => {
  const k = await Kernel.load();
  const s = await PlaneGcsSolver.create();
  const doc = parsePart(readFileSync('scratch/real-part1.json', 'utf8').replace(/^\uFEFF/, ''));

  // 1. 設回原本的 plane:front
  const sk4 = doc.features.find((f) => f.id === 'sketch4');
  sk4.plane = { kind: 'datum', name: 'plane:front' };

  // 2. 將 cut2 改為 Blind 1.2 mm (法向由下往上切 1.2 mm，正好切除凸緣高度)
  const cut2 = doc.features.find((f) => f.id === 'cut2') as any;
  cut2.dir1 = { type: 'blind', depth: '1.2' };

  const r = new Regenerator(k, s, new Map()).rebuild(doc);
  const b = r.body!;
  console.log('Rebuilt with Blind 1.2mm, valid:', k.check(b.shape).valid);

  // 檢查所有邊線
  console.log('=== EDGES OF B WITH BLIND 1.2 ===');
  const straightLugEdges: number[] = [];
  b.topology.edges.forEach((e, i) => {
    if (e.curve === 'line' && Math.abs((e.length ?? 0) - 1.2) < 1e-3) {
      straightLugEdges.push(i);
      console.log(`  Lug Edge ${i}: mid=[${e.mid?.map(v=>v.toFixed(3))}], name=${b.names.edges[i]}`);
    }
    if (e.curve === 'line' && (e.length ?? 0) > 2) {
      console.log(`  Ghost / Seam line ${i}: mid=[${e.mid?.map(v=>v.toFixed(3))}], len=${e.length?.toFixed(3)}, name=${b.names.edges[i]}`);
    }
  });

  console.log('Straight lug edges found:', straightLugEdges);

  console.log('\n=== ALL EDGES OF FACE 14 (cut2:side:sketch6.a3) ===');
  b.topology.edges.forEach((e, i) => {
    if (e.faces?.includes(14)) {
      console.log(`  Edge ${i}: curve=${e.curve}, mid=[${e.mid?.map(v=>v.toFixed(3))}], len=${e.length?.toFixed(3)}, name=${b.names.edges[i]}`);
    }
  });

  for (let rTest = 0.05; rTest <= 0.4; rTest += 0.05) {
    try {
      const res = k.fillet(b.shape, [23], +rTest.toFixed(2));
      const chk = k.check(res.shape);
      console.log(`  Edge 23 r=${rTest.toFixed(2)}: valid=${chk.valid}`);
      k.release(res.shape);
    } catch (err: any) {
      console.log(`  Edge 23 r=${rTest.toFixed(2)}: FAILED (${err.message})`);
    }
  }
});
