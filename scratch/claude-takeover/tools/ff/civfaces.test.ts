import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
const D = process.env.STEP_DIR!;
it('civ faces', async () => {
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const imp = kernel.importStep(new Uint8Array(readFileSync(`${D}/tmp/CIV0000467治具_step.STEP`)));
  const shape = k.get(imp.shape); const topo = kernel.topology(imp.shape);
  let fi = 0; const zs: number[][] = []; const dirs: Record<string, number> = {}; let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next(), fi++) {
    const ad = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(ex.Current()), true);
    if (String(ad.GetType()) !== 'GeomAbs_BSplineSurface' && !String(ad.GetType()).includes('BSpline')) continue;
    const u0 = ad.FirstUParameter(), u1 = ad.LastUParameter(), v0 = ad.FirstVParameter(), v1 = ad.LastVParameter();
    const P = (u: number, v: number) => { const p = ad.Value(u, v); return [p.X(), p.Y(), p.Z()]; };
    const a = P(u0, v0), b = P(u0, v1);
    const d = a.map((x, i) => b[i]! - x); const n = Math.hypot(...d); const key = d.map((x) => (x / n).toFixed(3)).join(',');
    dirs[key] = (dirs[key] ?? 0) + 1;
    for (const p of [a, b, P(u1, v0), P(u1, v1)]) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i]!, p[i]!); mx[i] = Math.max(mx[i]!, p[i]!); }
    zs.push([Math.min(a[2]!, b[2]!), Math.max(a[2]!, b[2]!)]);
  }
  const zr: Record<string, number> = {}; for (const [l, h] of zs) { const kk = `${l.toFixed(3)}..${h.toFixed(3)}`; zr[kk] = (zr[kk] ?? 0) + 1; }
  writeFileSync(process.env.OUT!, JSON.stringify({ dirs, zr, mn, mx, planes: topo.faces.filter((f) => f.geometry?.type === 'plane').length }, null, 1));
}, 600000);
