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

it('tests sketch4 on plane:right', () => {
  const doc = parsePart(readFileSync('scratch/real-part1.json', 'utf8').replace(/^\uFEFF/, ''));
  const sk4 = doc.features.find((f) => f.id === 'sketch4');
  if (sk4 && sk4.type === 'sketch') {
    sk4.plane = { kind: 'datum', name: 'plane:right' };
  }

  const r = new Regenerator(kernel, solver, new Map()).rebuild(doc);
  const b = r.body!;
  console.log('Rebuilt on plane:right, valid:', kernel.check(b.shape).valid);

  // 檢查所有長度為 1.2 的豎直邊
  const straightEdges = b.topology.edges
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.curve === 'line' && Math.abs((e.length ?? 0) - 1.2) < 1e-3);
  console.log('Straight edges on plane:right:', straightEdges.map(x => ({ i: x.i, mid: x.e.mid?.map(v=>v.toFixed(3)) })));

  // 測試每條邊的圓角
  straightEdges.forEach(({ i }) => {
    try {
      const res = kernel.fillet(b.shape, [i], 0.3);
      const chk = kernel.check(res.shape);
      console.log(`Edge ${i} on plane:right fillet 0.3: valid=${chk.valid}, badFaces=${chk.badFaces.length}`);
      kernel.release(res.shape);
    } catch (e: any) {
      console.log(`Edge ${i} on plane:right fillet 0.3: FAILED ${e.message ?? e}`);
    }
  });

  // 測試 4 條邊合在一起圓角
  const allIndices = straightEdges.map(x => x.i);
  try {
    const resAll = kernel.fillet(b.shape, allIndices, 0.3);
    const chkAll = kernel.check(resAll.shape);
    console.log(`ALL 4 EDGES on plane:right fillet 0.3 at once: valid=${chkAll.valid}, badFaces=${chkAll.badFaces.length}`);
    if (chkAll.valid) {
      const topo = kernel.topology(resAll.shape);
      const openEdges = topo.edges.filter(e => (e.faces?.length ?? 0) !== 2);
      console.log('OPEN EDGES count:', openEdges.length);
    }
    kernel.release(resAll.shape);
  } catch (e: any) {
    console.log(`ALL 4 EDGES on plane:right fillet 0.3: FAILED ${e.message ?? e}`);
  }
});
