import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
const D = process.env.STEP_DIR!;
it('civ section', async () => {
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const imp = kernel.importStep(new Uint8Array(readFileSync(`${D}/tmp/CIV0000467治具_step.STEP`)));
  const shape = k.get(imp.shape); const box = kernel.bounds(imp.shape);
  const out: any = { box, levels: [] };
  // section at several heights: the walls run along Z
  const zs = [9.85];
  for (const z of zs) {
    const pln = new oc.gp_Pln(new oc.gp_Pnt(0, 0, z), new oc.gp_Dir(0, 0, 1));
    const sec = new oc.BRepAlgoAPI_Section(shape, pln, true);
    const s = sec.Shape();
    const counts: Record<string, number> = {}; let poles = 0, rational = 0, maxPoles = 0; const degs: Record<number, number> = {}; let edges = 0;
    for (const ex = new oc.TopExp_Explorer(s, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
      edges++;
      const ad = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(ex.Current()));
      const type = String(ad.GetType()).replace('GeomAbs_', ''); counts[type] = (counts[type] ?? 0) + 1;
      if (type === 'BSplineCurve') { const h = ad.BSpline(); const c = h.get ? h.get() : h; poles += c.NbPoles(); maxPoles = Math.max(maxPoles, c.NbPoles()); if (c.IsRational()) rational++; degs[c.Degree()] = (degs[c.Degree()] ?? 0) + 1; }
    }
    // loops: connected components of the section's edges through shared vertices
    out.levels.push({ z, edges, counts, bsplinePoles: poles, maxPoles, rational, degs });
  }
  writeFileSync(process.env.OUT!, JSON.stringify(out, null, 1));
}, 600000);
