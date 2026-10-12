import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { parsePart } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';

it('investigates why edge 22 is different from edges 13, 18, 19', async () => {
  const k = await Kernel.load();
  const s = await PlaneGcsSolver.create();
  const doc = parsePart(readFileSync('scratch/real-part1.json', 'utf8').replace(/^\uFEFF/, ''));

  // 設為原本的 plane:front
  const sk4 = doc.features.find((f) => f.id === 'sketch4');
  sk4.plane = { kind: 'datum', name: 'plane:front' };

  // 檢查 cut2 之前的實體
  const docBeforeCut2 = JSON.parse(JSON.stringify(doc));
  docBeforeCut2.features = docBeforeCut2.features.filter((f: any) => f.id !== 'cut2');
  const rCut1 = new Regenerator(k, s, new Map()).rebuild(docBeforeCut2);
  const bCut1 = rCut1.body!;
  console.log('=== EDGES OF BODY BEFORE CUT2 ===');
  bCut1.topology.edges.forEach((e, i) => {
    if (e.curve === 'line') {
      console.log(`  Edge ${i}: mid=[${e.mid?.map(v=>v.toFixed(3))}], len=${e.length?.toFixed(3)}, name=${bCut1.names.edges[i]}`);
    }
  });

  const f8 = b.topology.faces[8]!;
  console.log('\n=== FACE 8 (revolve1:side:sketch4.l6) EDGES ===');
  const f8Edges = b.topology.edges
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.faces?.includes(8));
  f8Edges.forEach(({ e, i }) => {
    console.log(`  Edge ${i}: curve=${e.curve}, mid=[${e.mid?.map((v) => v.toFixed(3))}], name=${b.names.edges[i]}`);
  });

  const edges = [13, 18, 19, 22];
  edges.forEach((idx) => {
    const e = b.topology.edges[idx]!;
    console.log(`\n=== EDGE ${idx} ===`);
    console.log('mid:', e.mid);
    console.log('curve:', e.curve);
    console.log('faces:', e.faces);
    e.faces?.forEach((fi) => {
      const f = b.topology.faces[fi]!;
      console.log(`  Face ${fi}: surface=${f.surface}, normal=${f.normal}, name=${b.names.faces[fi]}`);
    });
    // 測試單獨做 0.3 圓角
    try {
      const res = k.fillet(b.shape, [idx], 0.3);
      const chk = k.check(res.shape);
      console.log(`  Fillet r=0.3 on ${idx}: valid=${chk.valid}, badFaces=${chk.badFaces?.length}`);
      k.release(res.shape);
    } catch (err: any) {
      console.log(`  Fillet r=0.3 on ${idx} THREW:`, err.message);
    }
  });
});
