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

const doc = parsePart(readFileSync('scratch/real-part1.json', 'utf8').replace(/^\uFEFF/, ''));

it('finds the true solution for fillet 4', () => {
  // 把草圖1設回 plane:front
  const sk4 = doc.features.find((f) => f.id === 'sketch4');
  if (sk4 && sk4.type === 'sketch') {
    sk4.plane = { kind: 'datum', name: 'plane:front' };
  }

  const r = new Regenerator(kernel, solver, new Map()).rebuild(doc);
  const b = r.body!;
  console.log('Rebuilt on plane:front, valid:', kernel.check(b.shape).valid);

  // 找回 4 條邊
  const edges = b.topology.edges
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.curve === 'line' && Math.abs((e.length ?? 0) - 1.2) < 1e-3);
  const edge22 = b.topology.edges[22]!;
  console.log('EDGE 22 ADJACENT FACES:', edge22.faces);
  edge22.faces?.forEach((fi) => {
    const f = b.topology.faces[fi]!;
    console.log(`Face ${fi}: surface=${f.surface}, normal=${f.normal?.map(v=>v.toFixed(3))}, name=${b.names.faces[fi]}`);
  });
  try {
    const res = kernel.fillet(b.shape, [22], 0.1);
    const chk = kernel.check(res.shape);
    console.log('Edge 22 fillet check valid:', chk.valid, 'badFaces:', chk.badFaces, 'badEdges:', chk.badEdges);
  } catch (err: any) {
    console.log('Edge 22 fillet FAILED with error:', err.message ?? err);
  }
  edges.forEach(({ e, i }) => {
    console.log(`Edge ${i} mid: [${e.mid?.map((v) => v.toFixed(3)).join(', ')}], curve: ${e.curve}, len: ${e.length?.toFixed(3)}, name: ${b.names.edges[i]}`);
  });
  const allEdges = b.topology.edges.map((e, i) => ({ e, i }));
  console.log('--- ALL EDGES OF B ---');
  allEdges.forEach(({ e, i }) => {
    if (b.names.edges[i]?.includes('#') || e.curve === 'line') {
      console.log(`Edge ${i} curve: ${e.curve}, mid: [${e.mid?.map((v) => v.toFixed(3)).join(', ')}], len: ${e.length?.toFixed(3)}, name: ${b.names.edges[i]}`);
    }
  });
  edges.forEach(({ i }) => {
    let maxR = 0;
    for (let rTest = 0.05; rTest <= 0.5; rTest += 0.05) {
      try {
        const res = kernel.fillet(b.shape, [i], +rTest.toFixed(2));
        const chk = kernel.check(res.shape);
        if (chk.valid) maxR = +rTest.toFixed(2);
        kernel.release(res.shape);
      } catch {}
    }
    console.log(`Edge ${i} on plane:front: max valid fillet radius = ${maxR}`);
  });

  console.log('\n--- TESTING 45 DEGREE DATUM PLANE ---');
  const doc45 = JSON.parse(JSON.stringify(doc));
  doc45.features.unshift({
    id: 'datum45',
    name: '基準面1',
    type: 'refPlane',
    suppressed: false,
    def: { mode: 'angle', plane: { kind: 'datum', name: 'plane:front' }, axis: { kind: 'datum', name: 'axis:y' }, angle: '45' },
  });
  doc45.features.find((f: any) => f.id === 'sketch4').plane = { kind: 'datum', name: 'datum45' };

  const r45 = new Regenerator(kernel, solver, new Map()).rebuild(doc45);
  const b45 = r45.body!;
  const edges45 = b45.topology.edges
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.curve === 'line' && Math.abs((e.length ?? 0) - 1.2) < 1e-3);
  console.log('4 straight edges on 45-degree plane:', edges45.map((x) => x.i));

  edges45.forEach(({ i }) => {
    let maxR = 0;
    for (let rTest = 0.05; rTest <= 0.5; rTest += 0.05) {
      try {
        const res = kernel.fillet(b45.shape, [i], +rTest.toFixed(2));
        const chk = kernel.check(res.shape);
        if (chk.valid) maxR = +rTest.toFixed(2);
        kernel.release(res.shape);
      } catch {}
    }
    console.log(`Edge ${i} on 45-deg: max valid fillet radius = ${maxR}`);
  });

  // 測試 4 條邊合在同一個特徵一次做 0.3 圓角！
  const resAll45 = kernel.fillet(b45.shape, [19, 21, 34, 36], 0.3);
  const chkAll45 = kernel.check(resAll45.shape);
  console.log(`4 EDGES AT ONCE on 45-deg (r=0.3): SUCCESS=${chkAll45.valid}, badFaces=${chkAll45.badFaces.length}`);

  const topo = kernel.topology(resAll45.shape);
  console.log('--- TOPO OF RES_ALL_45 ---');
  console.log('Total faces:', topo.faces.length);
  topo.faces.forEach((f, i) => {
    console.log(`Face ${i}: surface=${f.surface}, center=[${f.center?.map(v=>v.toFixed(3))}], area=${f.area?.toFixed(4)}`);
  });

  // 檢查是否有 free boundary (非封閉殼體) 或非流形邊 (non-manifold)
  const edgeFaceCounts = topo.edges.map((e, i) => ({
    i,
    facesCount: e.faces?.length ?? 0,
    curve: e.curve,
    mid: e.mid?.map(v => v.toFixed(3)),
    faces: e.faces,
  }));
  const openEdges = edgeFaceCounts.filter(x => x.facesCount !== 2);
  console.log('OPEN / NON-MANIFOLD EDGES (facesCount !== 2):', openEdges);

  // 用 Regenerator 完整確效含圓角特徵的 doc45
  const edgeRefs = [19, 21, 34, 36].map((i) => ({
    kind: 'edge' as const,
    name: b45.names.edges[i]!,
    fingerprint: {
      type: 'line' as const,
      size: b45.topology.edges[i]!.length ?? 1.2,
      center: b45.topology.edges[i]!.mid ?? [0, 0, 0],
      dir: [0, 1, 0] as [number, number, number],
    },
  }));

  doc45.features.push({
    id: 'fillet_lugs',
    name: '圓角1',
    type: 'fillet',
    suppressed: false,
    radius: '0.3',
    edges: edgeRefs,
  });

  const finalRegen = new Regenerator(kernel, solver, new Map()).rebuild(doc45);
  const finalFilletResult = finalRegen.features.find((f) => f.id === 'fillet_lugs');
  console.log('FINAL FILLET FEATURE RESULT:', {
    error: finalFilletResult?.error,
    message: finalFilletResult?.message,
    unresolved: finalFilletResult?.unresolved?.length,
    finalBodyValid: finalRegen.body ? kernel.check(finalRegen.body.shape).valid : false,
  });

  const { writeFileSync } = require('node:fs');
  writeFileSync('apps/web/public/real-part1-fixed.json', JSON.stringify(doc45, null, 2), 'utf8');
  console.log('Saved apps/web/public/real-part1-fixed.json');
});
