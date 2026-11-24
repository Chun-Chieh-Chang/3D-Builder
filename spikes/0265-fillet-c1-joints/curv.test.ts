// Probe: for every rolling-ball fuzz seed, the tightest concave bend of the boss's spline wall (radius of curvature, measured on the wall's own
// basis curve with OCCT's D2) against the round's radius. Writes out/prof46/curv.json. No fillet is made.
import { writeFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { Kernel } from '@3db/kernel';
import { sample, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';

it('curvature of every seed', async () => {
  const k = await Kernel.load(); const oc = k.oc as any;
  const rows: any[] = [];
  for (let seed = 1; seed <= 100; seed++) {
    const s = sample(seed);
    const m = splineBoss(k, s.top, s.h);
    const shape = (k as any).get(m.shape);
    const t = k.topology(m.shape); const wall = t.faces.findIndex((f) => !f.geometry);
    const map = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher(); oc.TopExp.MapShapes(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
    const ad = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(map.FindKey(wall + 1)), true);
    const c = ad.BasisCurve();
    const [u0, u1] = [c.FirstParameter(), c.LastParameter()];
    const p = new oc.gp_Pnt(0, 0, 0), d1 = new oc.gp_Vec(0, 0, 0), d2 = new oc.gp_Vec(0, 0, 0);
    let minConcave = Infinity, minAny = Infinity, at = 0;
    const N = 4000;
    for (let i = 0; i <= N; i++) {
      const u = u0 + (u1 - u0) * i / N;
      c.D2(u, p, d1, d2);
      // signed curvature in the plate's plane; the outline runs counterclockwise (seen from +z), so negative is a concave bend
      const cross = d1.X() * d2.Y() - d1.Y() * d2.X(); const sp = Math.hypot(d1.X(), d1.Y());
      const kappa = cross / sp ** 3;
      const rho = 1 / Math.abs(kappa);
      minAny = Math.min(minAny, rho);
      if (kappa < 0 && rho < minConcave) { minConcave = rho; at = u; }
    }
    rows.push({ seed, r: s.radius, minConcave: +minConcave.toFixed(4), minAny: +minAny.toFixed(4), ratio: +(s.radius / minConcave).toFixed(3), n: s.top.length });
    k.release(m.shape);
  }
  writeFileSync('out/prof46/curv.json', JSON.stringify(rows, null, 1));
  expect(rows.length).toBe(100);
}, 600_000);
