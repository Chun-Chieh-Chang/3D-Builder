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

it('tests 2D blend on sketch6 directly', () => {
  const doc = parsePart(readFileSync('scratch/real-part1.json', 'utf8').replace(/^\uFEFF/, ''));
  const sk4 = doc.features.find((f) => f.id === 'sketch4');
  if (sk4 && sk4.type === 'sketch') {
    sk4.plane = { kind: 'datum', name: 'plane:front' };
  }

  // 計算倒角幾何常數
  const R_inner = 3.125;
  const R_outer = 3.865;
  const x_line = 1.355;
  const r_fillet = 0.3;

  const xc = x_line - r_fillet; // 1.055
  const yc = Math.sqrt((R_inner - r_fillet) ** 2 - xc ** 2); // 2.620610619683999
  const scale = R_inner / (R_inner - r_fillet);
  const xt = xc * scale; // 1.1670353982300885
  const yt = yc * scale; // 2.8988626647902585

  // 外圓弧與 x = 1.355 的交點 y
  const y_outer = Math.sqrt(R_outer ** 2 - x_line ** 2); // 3.6196961198421067

  console.log('Fillet params:', { xc, yc, xt, yt, y_outer });

  // 構造帶有 4 個 0.3mm 圓角的 Region 0 和 Region 1
  // Region 1 (右邊切刀, x > 0):
  // 1. 直線: (x_line, y_outer) -> (x_line, yc)
  // 2. 圓弧: 從 (x_line, yc) 到 (xt, yt), 圓心 (xc, yc), 半徑 r_fillet, CCW
  // 3. 內圓弧 a3: 從 (xt, yt) 到 (xt, -yt), 圓心 (0, 0), 半徑 R_inner
  // 4. 圓弧: 從 (xt, -yt) 到 (x_line, -yc), 圓心 (xc, -yc), 半徑 r_fillet
  // 5. 直線: (x_line, -yc) 到 (x_line, -y_outer)
  // 6. 外圓弧 a4: 從 (x_line, -y_outer) 到 (x_line, y_outer), 圓心 (0, 0), 半徑 R_outer

  // 取得底面 frame
  const rInitial = new Regenerator(kernel, solver, new Map()).rebuild(doc);
  const frame = rInitial.sketches.get('sketch6')!.frame;

  const region1Outer = [
    { kind: 'line' as const, a: [x_line, y_outer] as [number, number], b: [x_line, yc] as [number, number], source: 'sk6.l13' },
    { kind: 'arc' as const, from: [x_line, yc] as [number, number], to: [xt, yt] as [number, number], c: [xc, yc] as [number, number], r: r_fillet, ccw: true, source: 'sk6.fillet1' },
    { kind: 'arc' as const, from: [xt, yt] as [number, number], to: [xt, -yt] as [number, number], c: [0, 0] as [number, number], r: R_inner, ccw: false, source: 'sk6.a3' },
    { kind: 'arc' as const, from: [xt, -yt] as [number, number], to: [x_line, -yc] as [number, number], c: [xc, -yc] as [number, number], r: r_fillet, ccw: true, source: 'sk6.fillet2' },
    { kind: 'line' as const, a: [x_line, -yc] as [number, number], b: [x_line, -y_outer] as [number, number], source: 'sk6.l16' },
    { kind: 'arc' as const, from: [x_line, -y_outer] as [number, number], to: [x_line, y_outer] as [number, number], c: [0, 0] as [number, number], r: R_outer, ccw: true, source: 'sk6.a4' },
  ];

  // Region 0 (左邊切刀, x < 0): 對稱於 y 軸
  const region0Outer = [
    { kind: 'line' as const, a: [-x_line, -y_outer] as [number, number], b: [-x_line, -yc] as [number, number], source: 'sk6.l15' },
    { kind: 'arc' as const, from: [-x_line, -yc] as [number, number], to: [-xt, -yt] as [number, number], c: [-xc, -yc] as [number, number], r: r_fillet, ccw: true, source: 'sk6.fillet3' },
    { kind: 'arc' as const, from: [-xt, -yt] as [number, number], to: [-xt, yt] as [number, number], c: [0, 0] as [number, number], r: R_inner, ccw: false, source: 'sk6.a2' },
    { kind: 'arc' as const, from: [-xt, yt] as [number, number], to: [-x_line, yc] as [number, number], c: [-xc, yc] as [number, number], r: r_fillet, ccw: true, source: 'sk6.fillet4' },
    { kind: 'line' as const, a: [-x_line, yc] as [number, number], b: [-x_line, y_outer] as [number, number], source: 'sk6.l12' },
    { kind: 'arc' as const, from: [-x_line, y_outer] as [number, number], to: [-x_line, -y_outer] as [number, number], c: [0, 0] as [number, number], r: R_outer, ccw: true, source: 'sk6.a1' },
  ];

  // 用 kernel.extrude 生成帶圓角的切刀，切除本體
  // 取 cut1 之後的本體
  const docBeforeCut2 = JSON.parse(JSON.stringify(doc));
  docBeforeCut2.features = docBeforeCut2.features.filter((f: any) => f.id !== 'cut2');
  const rBefore = new Regenerator(kernel, solver, new Map()).rebuild(docBeforeCut2);
  const baseShape = rBefore.body!.shape;

  // 切刀深度 1.2 mm（凸緣厚度）或 throughAll 8mm
  const toolResult = kernel.extrude(frame, [{ outer: region0Outer, holes: [] }, { outer: region1Outer, holes: [] }], [0, 8, 0], 0);
  const cutResult = kernel.cut(baseShape, toolResult.shape);

  const check = kernel.check(cutResult.shape);
  console.log('DIRECT 2D BLEND CHECK RESULT:', {
    valid: check.valid,
    badFaces: check.badFaces.length,
    badEdges: check.badEdges?.length,
  });

  const topo = kernel.topology(cutResult.shape);
  const openEdges = topo.edges.filter(e => (e.faces?.length ?? 0) !== 2);
  console.log('OPEN EDGES count:', openEdges.length);
  console.log('Total faces:', topo.faces.length);

  // 找切出來的圓角圓柱面 (r = 0.3)
  const filletFaces = topo.faces.filter(f => f.surface === 'cylinder' && f.radius && Math.abs(f.radius - 0.3) < 1e-3);
  console.log('Fillet cylindrical faces count (r=0.3):', filletFaces.length);
});
