import { readFileSync, writeFileSync } from 'node:fs';
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

it('verifies exact CCW arcs for 0.3mm lug fillets', () => {
  const doc = parsePart(readFileSync('scratch/real-part1.json', 'utf8').replace(/^\uFEFF/, ''));

  // 1. 確保 sketch4 在原始基準面 plane:front
  const sk4 = doc.features.find((f) => f.id === 'sketch4');
  if (sk4 && sk4.type === 'sketch') {
    sk4.plane = { kind: 'datum', name: 'plane:front' };
  }
  doc.features = doc.features.filter((f) => f.id !== 'datum45');

  // 幾何參數
  const R_inner = 3.125;
  const R_outer = 3.865;
  const x_line = 1.355;
  const r_fillet = 0.3;

  const xc = x_line - r_fillet; // 1.055
  const yc = Math.sqrt((R_inner - r_fillet) ** 2 - xc ** 2); // 2.620610615867989
  const scale = R_inner / (R_inner - r_fillet);
  const xt = xc * scale; // 1.1670353982300883
  const yt = yc * scale; // 2.8989055485265367
  const y_outer = Math.sqrt(R_outer ** 2 - x_line ** 2); // 3.6196961198421067

  const sk6 = doc.features.find((f) => f.id === 'sketch6') as any;

  const entities: any[] = [
    { id: 'p16', type: 'point', x: 0, y: 0 },
    { id: 'p27', type: 'point', x: 5, y: 0 },
    { id: 'p28', type: 'point', x: -5, y: 0 },
    { id: 'l14', type: 'line', p1: 'p27', p2: 'p28', construction: true },

    // --- 右邊輪廓 (x > 0) ---
    // l13: 直線從 (x_line, y_outer) 走到 (x_line, yc)
    { id: 'p22', type: 'point', x: x_line, y: y_outer },
    { id: 'p20', type: 'point', x: x_line, y: yc },
    { id: 'l13', type: 'line', p1: 'p22', p2: 'p20' },

    // af1: 倒角從 (x_line, yc) 走到 (xt, yt), 圓心 (xc, yc)
    { id: 'pf1_c', type: 'point', x: xc, y: yc },
    { id: 'pf1_t', type: 'point', x: xt, y: yt },
    { id: 'af1', type: 'arc', center: 'pf1_c', start: 'p20', end: 'pf1_t' },

    // a3: 內弧從 (xt, yt) 走到 (xt, -yt), 圓心 (0, 0)
    { id: 'pf2_t', type: 'point', x: xt, y: -yt },
    { id: 'a3', type: 'arc', center: 'p16', start: 'pf1_t', end: 'pf2_t' },

    // af2: 倒角從 (xt, -yt) 走到 (x_line, -yc), 圓心 (xc, -yc)
    { id: 'pf2_c', type: 'point', x: xc, y: -yc },
    { id: 'p32', type: 'point', x: x_line, y: -yc },
    { id: 'af2', type: 'arc', center: 'pf2_c', start: 'pf2_t', end: 'p32' },

    // l16: 直線從 (x_line, -yc) 走到 (x_line, -y_outer)
    { id: 'p31', type: 'point', x: x_line, y: -y_outer },
    { id: 'l16', type: 'line', p1: 'p32', p2: 'p31' },

    // a4: 外弧從 (x_line, -y_outer) 走到 (x_line, y_outer), 圓心 (0, 0)
    { id: 'a4', type: 'arc', center: 'p16', start: 'p31', end: 'p22' },

    // --- 左邊輪廓 (x < 0) ---
    // l15: 直線從 (-x_line, -y_outer) 走到 (-x_line, -yc)
    { id: 'p30', type: 'point', x: -x_line, y: -y_outer },
    { id: 'p29', type: 'point', x: -x_line, y: -yc },
    { id: 'l15', type: 'line', p1: 'p30', p2: 'p29' },

    // af3: 倒角從 (-x_line, -yc) 走到 (-xt, -yt), 圓心 (-xc, -yc)
    { id: 'pf3_c', type: 'point', x: -xc, y: -yc },
    { id: 'pf3_t', type: 'point', x: -xt, y: -yt },
    { id: 'af3', type: 'arc', center: 'pf3_c', start: 'p29', end: 'pf3_t' },

    // a2: 內弧從 (-xt, -yt) 走到 (-xt, yt), 圓心 (0, 0)
    { id: 'pf4_t', type: 'point', x: -xt, y: yt },
    { id: 'a2', type: 'arc', center: 'p16', start: 'pf3_t', end: 'pf4_t' },

    // af4: 倒角從 (-xt, yt) 走到 (-x_line, yc), 圓心 (-xc, yc)
    { id: 'pf4_c', type: 'point', x: -xc, y: yc },
    { id: 'p17', type: 'point', x: -x_line, y: yc },
    { id: 'af4', type: 'arc', center: 'pf4_c', start: 'pf4_t', end: 'p17' },

    // l12: 直線從 (-x_line, yc) 走到 (-x_line, y_outer)
    { id: 'p21', type: 'point', x: -x_line, y: y_outer },
    { id: 'l12', type: 'line', p1: 'p17', p2: 'p21' },

    // a1: 外弧從 (-x_line, y_outer) 走到 (-x_line, -y_outer), 圓心 (0, 0)
    { id: 'a1', type: 'arc', center: 'p16', start: 'p21', end: 'p30' },
  ];

  sk6.entities = entities;
  sk6.constraints = [
    { id: 'c15', type: 'coincident', a: 'p16', b: '@origin' },
  ];

  doc.features = doc.features.filter((f) => f.id !== 'fillet_lugs');

  const r = new Regenerator(kernel, solver, new Map()).rebuild(doc);
  const cut2Res = r.features.find(f => f.id === 'cut2');
  console.log('cut2 result:', { error: cut2Res?.error, message: cut2Res?.message });
  const sk6Res = r.sketches.get('sketch6')!;
  console.log('sketch6 regions count:', sk6Res.profiles.regions.length);
  sk6Res.profiles.regions.forEach((reg, i) => {
    console.log(`Region ${i} segments count:`, reg.outer.length);
  });

  const b = r.body!;
  const chk = kernel.check(b.shape);
  console.log('Body check valid:', chk.valid);
  console.log('Bad faces count:', chk.badFaces.length);

  const topo = kernel.topology(b.shape);
  console.log('Total faces:', topo.faces.length);
  const openEdges = topo.edges.filter((e) => (e.faces?.length ?? 0) !== 2);
  console.log('Open edges count:', openEdges.length);

  // 找 0.3mm 圓柱面
  const filletFaces = topo.faces.filter((f) => f.surface === 'cylinder' && f.radius && Math.abs(f.radius - 0.3) < 1e-3);
  console.log('Found 0.3mm fillet cylindrical faces:', filletFaces.length);
  filletFaces.forEach((f, i) => {
    console.log(`  Fillet ${i}: center=[${f.center?.map(v=>v.toFixed(3))}], area=${f.area?.toFixed(4)}`);
  });

  // 如果完全成功，儲存到 public/real-part1-fixed.json
  if (chk.valid && chk.badFaces.length === 0 && openEdges.length === 0 && filletFaces.length === 4) {
    writeFileSync('apps/web/public/real-part1-fixed.json', JSON.stringify(doc, null, 2), 'utf8');
    console.log('SUCCESS! Saved to apps/web/public/real-part1-fixed.json');
  }
});
