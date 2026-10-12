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

it('analyzes cut2 profiles and edges', () => {
  const doc = parsePart(readFileSync('scratch/real-part1.json', 'utf8').replace(/^\uFEFF/, ''));
  // 保持 plane:front
  const sk4 = doc.features.find((f) => f.id === 'sketch4');
  if (sk4 && sk4.type === 'sketch') {
    sk4.plane = { kind: 'datum', name: 'plane:front' };
  }

  // 檢查 cut2
  const cut2 = doc.features.find((f) => f.id === 'cut2') as any;
  console.log('Original cut2 dir1:', cut2.dir1);

  // 嘗試 1：把 cut2 改成 blind 1.2 mm，看 b.shape 會如何
  const docBlind = JSON.parse(JSON.stringify(doc));
  const cut2Blind = docBlind.features.find((f: any) => f.id === 'cut2');
  cut2Blind.dir1 = { type: 'blind', depth: '1.2' };

  const rBlind = new Regenerator(kernel, solver, new Map()).rebuild(docBlind);
  const bBlind = rBlind.body!;
  console.log('Rebuilt with cut2 blind 1.2mm, valid:', kernel.check(bBlind.shape).valid);

  const edgesBlind = bBlind.topology.edges
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.curve === 'line' && Math.abs((e.length ?? 0) - 1.2) < 1e-3);
  console.log('Edges length 1.2mm in blind body:', edgesBlind.map(x => ({ i: x.i, mid: x.e.mid?.map(v => v.toFixed(3)) })));

  // 深入檢查這條失敗的邊與相鄰面
  const failEdge = bBlind.topology.edges[23]!;
  console.log('Fail edge 23 faces:', failEdge.faces);
  failEdge.faces?.forEach(fi => {
    const f = bBlind.topology.faces[fi]!;
    console.log(`Face ${fi}: surface=${f.surface}, normal=${f.normal}, center=${f.center}`);
  });
  // 檢查所有曲線是 line 的邊，且在圓柱面上的 seam
  bBlind.topology.edges.forEach((e, i) => {
    if (e.curve === 'line') {
      console.log(`Line Edge ${i}: mid=[${e.mid?.map(v=>v.toFixed(3))}], len=${e.length?.toFixed(3)}, faces=${e.faces}`);
    }
  });

  const allIndices = edgesBlind.map(x => x.i);
  try {
    const resAll = kernel.fillet(bBlind.shape, allIndices, 0.3);
    const chkAll = kernel.check(resAll.shape);
    console.log(`ALL 4 EDGES blind 1.2mm fillet 0.3 at once: valid=${chkAll.valid}, badFaces=${chkAll.badFaces.length}`);
    if (chkAll.valid) {
      const topo = kernel.topology(resAll.shape);
      const edgeFaceCounts = topo.edges.map((e, i) => ({ i, facesCount: e.faces?.length ?? 0 }));
      const openEdges = edgeFaceCounts.filter(x => x.facesCount !== 2);
      console.log('Open edges in blind fillet 0.3:', openEdges.length);
    }
    kernel.release(resAll.shape);
  } catch (e: any) {
    console.log(`ALL 4 EDGES blind 1.2mm fillet 0.3: FAILED ${e.message ?? e}`);
  }
});
