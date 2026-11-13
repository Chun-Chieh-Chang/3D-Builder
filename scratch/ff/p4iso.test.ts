// part-4 round-like faces: do the arc's two boundary iso lines (v at both ends) lie on two neighbours' surfaces, and is the face tangent to them there?
// For each face, each neighbour: max distance of 21 points of each iso line to the neighbour's (untrimmed) surface, and max angle between normals.
import { appendFileSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';
const log = (m: string) => appendFileSync('scratch/ff/p4iso.log', m + String.fromCharCode(10));
it('p4iso', async () => {
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const whole = new Uint8Array(readFileSync('D:/3DB實機確認/tmp/組合圖(R1-10226+R1-10134).STEP'));
  const id = kernel.importStep(stepAssemblyPlan(kernel, whole).prototypes.filter((p: any) => p.part)[3]!.part!.step).shape;
  const topo = kernel.topology(id);
  const faces: any[] = []; for (const ex = new oc.TopExp_Explorer(k.get(id), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
  const pt = (p: any) => { const o = [p.X(), p.Y(), p.Z()]; p.delete(); return o; };
  for (const f of [22, 28, 41, 47, 135, 136, 163, 164, 66]) {
    const ad = new oc.BRepAdaptor_Surface(faces[f], true);
    const [u0, u1, v0, v1] = [ad.FirstUParameter(), ad.LastUParameter(), ad.FirstVParameter(), ad.LastVParameter()];
    const nb = [...new Set(topo.edges.flatMap((e) => (e.faces.includes(f) ? e.faces.filter((g) => g !== f) : [])))];
    const lines: string[] = [];
    for (const v of [v0, v1]) {
      let best = { g: -1, d: Infinity, ang: 0 };
      for (const g of nb) {
        const S = oc.BRep_Tool.Surface(faces[g]); const pr = new oc.GeomAPI_ProjectPointOnSurf(); 
        let d = 0, ang = 0;
        for (let i = 0; i <= 20; i++) {
          const u = u0 + ((u1 - u0) * i) / 20; const p = ad.Value(u, v); pr.Init(p, S); 
          if (pr.NbPoints() === 0) { d = Infinity; p.delete(); break; }
          d = Math.max(d, pr.LowerDistance());
          // normals: the face's at (u, v), the neighbour's at the foot
          const P = new oc.gp_Pnt(), DU = new oc.gp_Vec(), DV = new oc.gp_Vec(); ad.D1(u, v, P, DU, DV); const n1 = DU.Crossed(DV);
          const uv = pr.LowerDistanceParameters(); const ga = new oc.GeomAdaptor_Surface(S); const Q = new oc.gp_Pnt(), QU = new oc.gp_Vec(), QV = new oc.gp_Vec(); ga.D1(uv.U ?? uv[0], uv.V ?? uv[1], Q, QU, QV); const n2 = QU.Crossed(QV);
          ang = Math.max(ang, Math.min(n1.Angle(n2), Math.PI - n1.Angle(n2)));
          for (const x of [P, DU, DV, n1, ga, Q, QU, QV, n2, p]) x.delete();
        }
        pr.delete();
        if (d < best.d) best = { g, d, ang };
      }
      lines.push(`v=${v.toFixed(3)} on f${best.g}:${topo.faces[best.g]?.surface} d ${best.d.toExponential(1)} angle ${best.ang.toExponential(1)}`);
    }
    log(`f${f}: ${lines.join(' | ')}`);
    ad.delete();
  }
}, 600_000);
