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

it('inspects edge 22 in original part deeply', () => {
  const doc = parsePart(readFileSync('scratch/real-part1.json', 'utf8').replace(/^\uFEFF/, ''));
  const sk4 = doc.features.find((f) => f.id === 'sketch4');
  if (sk4 && sk4.type === 'sketch') {
    sk4.plane = { kind: 'datum', name: 'plane:front' };
  }

  const r = new Regenerator(kernel, solver, new Map()).rebuild(doc);
  const b = r.body!;
  
  // 打印 4 條豎直邊的詳細頂點與長度
  const straightEdges = [13, 18, 19, 22].map((i) => {
    const e = b.topology.edges[i]!;
    return {
      i,
      curve: e.curve,
      len: e.length,
      mid: e.mid,
      faces: e.faces,
      name: b.names.edges[i],
    };
  });
  console.log('4 straight edges details:', JSON.stringify(straightEdges, null, 2));

  // 測試：嘗試各種半徑對 edge 22 進行圓角
  [0.01, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3].forEach((rad) => {
    try {
      const res = kernel.fillet(b.shape, [22], rad);
      const chk = kernel.check(res.shape);
      console.log(`Radius ${rad} on edge 22: valid=${chk.valid}, badFaces=${chk.badFaces?.length ?? 0}`);
      kernel.release(res.shape);
    } catch (e: any) {
      console.log(`Radius ${rad} on edge 22: THREW ${e.message ?? e}`);
    }
  });

  // 測試：同時對 [13, 18, 19, 22] 進行圓角（合在一起做）
  [0.05, 0.1, 0.2, 0.3].forEach((rad) => {
    try {
      const res = kernel.fillet(b.shape, [13, 18, 19, 22], rad);
      const chk = kernel.check(res.shape);
      console.log(`ALL 4 EDGES radius ${rad}: valid=${chk.valid}, badFaces=${chk.badFaces?.length ?? 0}`);
      kernel.release(res.shape);
    } catch (e: any) {
      console.log(`ALL 4 EDGES radius ${rad}: THREW ${e.message ?? e}`);
    }
  });
});
