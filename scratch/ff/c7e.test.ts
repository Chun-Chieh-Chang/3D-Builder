// The fuzz cases refused as invalid or closing: the spline's smallest radius of curvature against the inset H·tan|α| (offsetting a curve by more
// than it bends ties the offset into a loop).
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
const log = (m: string) => appendFileSync('scratch/ff/c7.log', m + String.fromCharCode(10));
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const L = (a: number[], b: number[], source: string) => ({ kind: 'line', a, b, source });
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function sample(seed: number) {
  const r = rng(seed); const rd = (v: number) => Math.round(v * 1000) / 1000;
  const [w, h] = [rd(15 + 25 * r()), rd(12 + 18 * r())];
  const n = 1 + Math.floor(r() * 3);
  const mids = Array.from({ length: n }, (_, i) => [rd(w * (1 - (i + 1) / (n + 1))), rd(h + (r() * 1.4 - 0.4) * h * 0.4)]);
  const sign = r() < 0.5 ? 1 : -1; const H = rd(3 + 22 * r()); const deg = 0.5 + 7.5 * r();
  const angle = sign * Math.min((deg * Math.PI) / 180, Math.atan((0.2 * Math.min(w, h)) / H));
  return { w, h, mids, H, angle };
}
it('c7e', async () => {
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  for (const seed of (process.env.SEEDS ?? '').split(',').map(Number)) {
    const s = sample(seed);
    const outer = [L([0, 0], [s.w, 0], 'a'), L([s.w, 0], [s.w, s.h], 'b'), { kind: 'spline', points: [[s.w, s.h], ...s.mids, [0, s.h]], source: 'c' }, L([0, s.h], [0, 0], 'd')];
    const st = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, s.H]).shape;
    let minR = Infinity;
    for (const ex = new oc.TopExp_Explorer(k.get(st), oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
      const ad = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(ex.Current()));
      if (!String(ad.GetType()).includes('BSpline') || Math.abs(ad.Value(ad.FirstParameter()).Z()) > 1e-9) continue;
      const P = new oc.gp_Pnt(), V1 = new oc.gp_Vec(), V2 = new oc.gp_Vec();
      for (let i = 0; i <= 400; i++) {
        ad.D2(ad.FirstParameter() + ((ad.LastParameter() - ad.FirstParameter()) * i) / 400, P, V1, V2);
        const cr = Math.abs(V1.X() * V2.Y() - V1.Y() * V2.X());
        const sp = V1.Magnitude();
        if (cr > 1e-12) minR = Math.min(minR, sp ** 3 / cr);
      }
    }
    const inset = s.H * Math.tan(Math.abs(s.angle));
    log(`curvature seed ${seed} (${((s.angle * 180) / Math.PI).toFixed(2)}°): smallest radius of curvature ${minR.toFixed(3)} mm, inset ${inset.toFixed(3)} mm → ${minR < inset ? 'TIGHTER than the inset' : 'wider'}`);
  }
}, 300_000);
