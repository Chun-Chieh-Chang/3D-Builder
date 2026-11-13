import { it } from 'vitest';
import { Kernel, nurbsEval } from '@3db/kernel';
import { outline, plate, region, rng } from '../../tests/phase8/nurbs-walls.kit';
it('kit areas', async () => {
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const own = (id: number) => id;
  const r = rng(7);
  const outer = outline(r, [2, -1], 12, 14, 3, true, false);
  const hole = outline(r, [2, -1], 4.5, 9, 2, false, false);
  // exact length of the outline and hole
  const len = (o: any[]) => o.reduce((acc, s) => { if (s.kind === 'line') return acc + Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]); let L = 0; const g = [-0.9061798459, -0.5384693101, 0, 0.5384693101, 0.9061798459], w = [0.2369268851, 0.4786286705, 0.5688888889, 0.4786286705, 0.2369268851]; for (let i = 0; i < s.knots.length - 1; i++) { const a = s.knots[i], b = s.knots[i + 1]; const N = 200; for (let q = 0; q < N; q++) { const a2 = a + (b - a) * q / N, b2 = a + (b - a) * (q + 1) / N; for (let j = 0; j < 5; j++) { const { d } = nurbsEval(s, (a2 + b2) / 2 + (b2 - a2) / 2 * g[j]!); L += w[j]! * Math.hypot(d[0], d[1]) * (b2 - a2) / 2; } } } return acc + L; }, 0);
  const exactWall = (len(outer) + len(hole)) * 0.6;
  for (const bs of [false]) {
    const s = plate(kernel, 50, 40, 8, region(outer, hole), 0.6, false, bs, own);
    const t = kernel.topology(s);
    const wallsFixed = t.faces.filter((f) => !['plane'].includes(f.surface)).reduce((a, f) => a + f.area, 0);
    let fi = 0; let wallsEps = 0; let wallsEpsErr = 0;
    for (const ex = new oc.TopExp_Explorer(k.get(s), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next(), fi++) {
      if (t.faces[fi]!.surface === 'plane') continue;
      const g = new oc.GProp_GProps(); const e = oc.BRepGProp.SurfaceProperties(ex.Current(), g, 1e-9, false); wallsEps += g.Mass(); wallsEpsErr = Math.max(wallsEpsErr, e);
    }
    const conv = k.put(oc.ShapeCustom.ConvertToBSpline(k.get(s), true, false, false, false));
    console.log(JSON.stringify({ convEps: kernel.surfaceArea(conv), convRel: (kernel.surfaceArea(conv) - 5500.844752088769) / 5500.844752088769, bs, types: [...new Set(t.faces.map((f) => f.surface))], exactWall, wallsFixed, wallsEps, wallsEpsErr, relFixed: (wallsFixed - exactWall) / exactWall, relEps: (wallsEps - exactWall) / exactWall, totalFixed: kernel.massProps(s).area, totalEps: kernel.surfaceArea(s) }));
  }
}, 300000);
