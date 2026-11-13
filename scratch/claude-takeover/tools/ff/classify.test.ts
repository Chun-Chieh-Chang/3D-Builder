import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';

const D = process.env.STEP_DIR!;
const TARGETS: [string, number | null][] = JSON.parse(process.env.TARGETS!);

it('classifies every non-analytic face', async () => {
  const kernel = await Kernel.load();
  const k = kernel as any;
  const oc = k.oc;
  const out: any[] = [];
  for (const [rel, part] of TARGETS) {
    let bytes = new Uint8Array(readFileSync(`${D}/${rel}`));
    if (part !== null) bytes = stepAssemblyPlan(kernel, bytes).prototypes.filter((p: any) => p.part)[part]!.part!.step;
    const imported = kernel.importStep(bytes);
    const shape = k.get(imported.shape);
    const topo = kernel.topology(imported.shape);
    const faces: any[] = [];
    let fi = 0;
    const counts: Record<string, number> = {};
    for (const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next(), fi++) {
      const face = oc.TopoDS.Face(ex.Current());
      const ad = new oc.BRepAdaptor_Surface(face, true);
      const type = String(ad.GetType()).replace('GeomAbs_', '');
      counts[type] = (counts[type] ?? 0) + 1;
      if (['Plane', 'Cylinder', 'Cone', 'Sphere', 'Torus'].includes(type)) continue;
      const rec: any = { face: fi, type, area: topo.faces[fi]?.area, u: [ad.FirstUParameter(), ad.LastUParameter()], v: [ad.FirstVParameter(), ad.LastVParameter()] };
      try {
        if (type === 'BSplineSurface') {
          const h = ad.BSpline(); const s = h.get ? h.get() : h;
          rec.deg = [s.UDegree(), s.VDegree()]; rec.poles = [s.NbUPoles(), s.NbVPoles()];
          rec.rational = [s.IsURational(), s.IsVRational()]; rec.periodic = [s.IsUPeriodic(), s.IsVPeriodic()];
          const P: number[][][] = [];
          for (let i = 1; i <= s.NbUPoles(); i++) { const row: number[][] = []; for (let j = 1; j <= s.NbVPoles(); j++) { const p = s.Pole(i, j); row.push([p.X(), p.Y(), p.Z()]); } P.push(row); }
          // straight in one direction with one constant offset: an extrusion of a curve
          const dirTest = (A: number[][][]) => { // A[i][j]: is A[i][j]-A[0][j] the same vector for all j, for each i ?
            let worst = 0;
            for (let i = 1; i < A.length; i++) for (let j = 0; j < A[0]!.length; j++) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs((A[i]![j]![c]! - A[0]![j]![c]!) - (A[i]![0]![c]! - A[0]![0]![c]!)));
            return worst;
          };
          const T = P[0]!.map((_, j) => P.map((r) => r[j]!));
          rec.translateU = dirTest(P); rec.translateV = dirTest(T);
          rec.weightsUniform = (() => { let w0 = s.Weight(1, 1), d = 0; for (let i = 1; i <= s.NbUPoles(); i++) for (let j = 1; j <= s.NbVPoles(); j++) d = Math.max(d, Math.abs(s.Weight(i, j) - w0)); return d; })();
        } else if (type === 'SurfaceOfExtrusion' || type === 'SurfaceOfRevolution') {
          const c = ad.BasisCurve(); rec.basis = String(c.GetType ? c.GetType() : '?');
          if (type === 'SurfaceOfExtrusion') { const d = ad.Direction(); rec.dir = [d.X(), d.Y(), d.Z()]; }
          else { const a = ad.AxeOfRevolution(); const l = a.Location(), d = a.Direction(); rec.axis = [[l.X(), l.Y(), l.Z()], [d.X(), d.Y(), d.Z()]]; }
        } else if (type === 'OffsetSurface') { rec.offset = ad.OffsetValue(); rec.basis = String(ad.BasisSurface().GetType()); }
      } catch (e) { rec.err = String(e).slice(0, 200); }
      faces.push(rec);
    }
    const box = kernel.bounds(imported.shape);
    out.push({ rel, part, nFaces: fi, counts, box, faces });
    kernel.release(imported.shape);
  }
  writeFileSync(process.env.OUT!, JSON.stringify(out, null, 1));
}, 600000);
