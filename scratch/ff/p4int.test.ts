// part-4 round-like faces: ∫ over the face of how far it is from the exact rolling ball of its radius on its two supports (the volume an exact native
// round would move), against 1e-6 of the part's volume. Per point p (uv grid inside the face): centre c = p ∓ r·n (the side nearer to both supports),
// distance to each support's untrimmed surface d1, d2; the exact round passes through the point at distance about max|di - r| from p.
import { appendFileSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';
import { supportOf, sD1, cross, unit, add, mul, len } from '../../packages/kernel/src/exactRound';
const log = (m: string) => appendFileSync('scratch/ff/p4int.log', m + String.fromCharCode(10));
it('p4int', async () => {
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const whole = new Uint8Array(readFileSync('D:/3DB實機確認/tmp/組合圖(R1-10226+R1-10134).STEP'));
  const id = kernel.importStep(stepAssemblyPlan(kernel, whole).prototypes.filter((p: any) => p.part)[3]!.part!.step).shape;
  const V = kernel.massProps(id).volume;
  const faces: any[] = []; for (const ex = new oc.TopExp_Explorer(k.get(id), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
  let total = 0;
  for (const [f, s1, s2, r] of [[22, 168, 190, 0.381], [28, 179, 167, 0.381], [41, 170, 213, 0.381], [47, 201, 169, 0.381], [135, 170, 211, 0.635], [136, 203, 169, 0.635], [163, 168, 188, 0.635], [164, 181, 167, 0.635], [66, 282, 244, 1.524]] as const) {
    const A = supportOf(oc, faces[s1]), B = supportOf(oc, faces[s2]);
    const ad = new oc.BRepAdaptor_Surface(faces[f], true);
    const [u0, u1, v0, v1] = [ad.FirstUParameter(), ad.LastUParameter(), ad.FirstVParameter(), ad.LastVParameter()];
    const N = 120, M = 12; let integral = 0, area = 0, worst = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
      const u = u0 + ((u1 - u0) * (i + 0.5)) / N, v = v0 + ((v1 - v0) * (j + 0.5)) / M;
      const d = sD1(oc, ad, u, v); const nn = cross(d.du as any, d.dv as any); const w = len(nn) * ((u1 - u0) / N) * ((v1 - v0) / M);
      let best = Infinity;
      for (const s of [1, -1]) { const c = add(d.p as any, mul(unit(nn), s * r)); best = Math.min(best, Math.max(Math.abs(A.dist(c) - r), Math.abs(B.dist(c) - r))); }
      integral += best * w; area += w; worst = Math.max(worst, best);
    }
    total += integral;
    log(`f${f} r ${r} area ${area.toFixed(3)} worst ${worst.toExponential(2)} integral ${integral.toExponential(2)} mm3`);
    ad.delete(); A.release(); B.release();
  }
  log(`total ${total.toExponential(2)} mm3 = ${(total / V).toExponential(2)} of the volume ${V.toFixed(1)} (gate 1e-6)`);
}, 600_000);
