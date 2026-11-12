// part-4: the 5 faces left after rounds. Degrees, conversion to an analytic surface, and for the ruled ones the direction of the rulings.
import { appendFileSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';
const log = (m: string) => appendFileSync('scratch/ff/p4rest.log', m + String.fromCharCode(10));
it('p4rest', async () => {
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const whole = new Uint8Array(readFileSync('D:/3DB實機確認/tmp/組合圖(R1-10226+R1-10134).STEP'));
  const id = kernel.importStep(stepAssemblyPlan(kernel, whole).prototypes.filter((p: any) => p.part)[3]!.part!.step).shape;
  const faces: any[] = []; for (const ex = new oc.TopExp_Explorer(k.get(id), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
  const P = (p: any) => [p.X(), p.Y(), p.Z()];
  for (const f of [11, 171, 172, 173, 174]) {
    const S = oc.BRep_Tool.Surface(faces[f]);
    const ad = new oc.BRepAdaptor_Surface(faces[f], true);
    let info = `deg ${ad.UDegree()}x${ad.VDegree()} poles ${ad.NbUPoles()}x${ad.NbVPoles()} rat ${ad.IsURational()}/${ad.IsVRational()} u[${ad.FirstUParameter().toFixed(3)},${ad.LastUParameter().toFixed(3)}] v[${ad.FirstVParameter().toFixed(3)},${ad.LastVParameter().toFixed(3)}]`;
    const conv: string[] = [];
    for (const tol of [1e-6, 1e-5, 1e-4, 1e-3, 7e-3]) {
      const c = new oc.GeomConvert_SurfToAnaSurf(S); const r = c.ConvertToAnalytical(tol);
      conv.push(r ? `${tol}:${r.DynamicType().Name()} gap ${c.Gap().toExponential(1)}` : `${tol}:-`);
    }
    // rulings: the v-direction at u samples (v-degree 1 means straight in v)
    const dirs: string[] = [];
    const [u0, u1, v0, v1] = [ad.FirstUParameter(), ad.LastUParameter(), ad.FirstVParameter(), ad.LastVParameter()];
    for (let i = 0; i <= 4; i++) {
      const u = u0 + ((u1 - u0) * i) / 4; const a = P(ad.Value(u, v0)), b = P(ad.Value(u, v1));
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const L = Math.hypot(...d);
      dirs.push(`[${a.map((x) => x.toFixed(2))}]→(${d.map((x) => (x / L).toFixed(4))})L${L.toFixed(2)}`);
    }
    log(`f${f} ${info} | ana ${conv.join(' ; ')}\n   rulings ${dirs.join(' ')}`);
  }
}, 600_000);
