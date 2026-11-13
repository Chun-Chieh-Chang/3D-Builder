// What the freeform faces left after C2 are, per refused real part (C4/C5 scoping): for each face that recognition calls freeform (not analytic, not a
// rolling-ball round): (1) an analytic surface in disguise (GeomConvert_SurfToAnaSurf at 1e-7 and 1e-6: type and gap); (2) a rolling ball between
// some pair of smoothly joined neighbours (any tolerance up to 1e-4, to see near misses); (3) a curve carried straight along an axis or a plane normal of
// the body (faceExtrudedAlong); (4) else: its type, degrees, poles, area. FILE = path under STEP_DIR, LABELS = JSON list of target labels to take.
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';

const ANALYTIC = new Set(['plane', 'cylinder', 'cone', 'sphere', 'torus']);
const trace = (m: string) => appendFileSync('scratch/ff/residual.trace', m + String.fromCharCode(10));

it('residual freeform faces', async () => {
  const dir = process.env.STEP_DIR!, rel = process.env.FILE!, out = process.env.OUT!, want: string[] = JSON.parse(process.env.LABELS ?? '["whole"]');
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const whole = new Uint8Array(readFileSync(join(dir, rel)));
  let targets: { label: string; bytes: Uint8Array }[];
  try {
    const parts = stepAssemblyPlan(kernel, whole).prototypes.filter((p: any) => p.part);
    targets = parts.length > 1 ? parts.map((p: any, i: number) => ({ label: `part-${i + 1}`, bytes: p.part.step })) : [{ label: 'whole', bytes: whole }];
  } catch { targets = [{ label: 'whole', bytes: whole }]; }
  for (const { label, bytes } of targets.filter((t) => want.includes(t.label))) {
    trace(`${rel} ${label} start`);
    const id = kernel.importStep(bytes).shape;
    const topo = kernel.topology(id);
    const smooth = kernel.smoothEdges(id, topo.edges.map((_, i) => i));
    const faces: any[] = [];
    for (const ex = new oc.TopExp_Explorer(k.get(id), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
    const odd = topo.faces.flatMap((f, i) => (ANALYTIC.has(f.surface) && f.geometry ? [] : [i]));
    const oddSet = new Set(odd);
    // the directions an extrusion could be along: the axes and every plane normal of the body
    const dirs: number[][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (const f of topo.faces) if (f.geometry?.type === 'plane') { const n = (f.geometry as any).normal as number[]; if (!dirs.some((d) => Math.abs(d[0]! * n[0]! + d[1]! * n[1]! + d[2]! * n[2]!) > 1 - 1e-9)) dirs.push(n); }
    const rows: any[] = [];
    for (const i of odd) {
      const f = topo.faces[i]!;
      const row: any = { face: i, surface: f.surface, area: +f.area.toFixed(4) };
      // smooth neighbours
      const nb = new Set<number>();
      topo.edges.forEach((e, j) => { if (e.faces.includes(i) && smooth[j]) for (const g of e.faces) if (g !== i) nb.add(g); });
      row.smoothNb = [...nb].map((g) => `${g}${oddSet.has(g) ? '*' : ''}`);
      // (1) analytic in disguise
      try {
        const S = oc.BRep_Tool.Surface(faces[i]);
        for (const tol of [1e-7, 1e-6, 1e-4]) {
          const cv = new oc.GeomConvert_SurfToAnaSurf(S);
          const a = cv.ConvertToAnalytical(tol);
          const ok = a && !(typeof a.IsNull === 'function' && a.IsNull());
          if (ok) { const ad = new oc.GeomAdaptor_Surface(a); row.ana = { tol, type: String(ad.GetType()?.value ?? ad.GetType()).replace('GeomAbs_', ''), gap: cv.Gap() }; ad.delete(); }
          cv.delete();
          if (ok) break;
        }
      } catch (e) { row.anaErr = String(e).slice(0, 80); }
      // (2) rolling ball between a pair of smooth neighbours
      const n = [...nb];
      let best: any = null;
      for (let a = 0; a < n.length; a++) for (let b = a + 1; b < n.length; b++) {
        try { const r = kernel.rollingBall(id, i, [n[a]!, n[b]!], 1e-4); if (r && (!best || r.deviation < best.deviation)) best = { ...r, supports: [n[a], n[b]] }; } catch (e) { row.ballErr = String(e).slice(0, 80); }
      }
      if (best) row.ball = { r: +best.radius.toFixed(5), dev: best.deviation, supports: best.supports.map((g: number) => `${g}${oddSet.has(g) ? '*' : ''}:${topo.faces[g]!.surface}`) };
      // (3) extruded along an axis or a plane normal
      for (const d of dirs) { try { if (kernel.faceExtrudedAlong(id, i, d as any)) { row.extruded = d.map((x) => +x.toFixed(4)); break; } } catch { /* asked of a face it cannot read */ } }
      // (4) what it is
      try {
        const ad = new oc.BRepAdaptor_Surface(faces[i], true);
        const ty = String(ad.GetType()?.value ?? ad.GetType()).replace('GeomAbs_', '');
        row.type = ty;
        if (ty === 'BSplineSurface') { const h = ad.BSpline(); const s = h.get ? h.get() : h; row.deg = [s.UDegree(), s.VDegree()]; row.poles = [s.NbUPoles(), s.NbVPoles()]; row.rational = s.IsURational() || s.IsVRational(); }
        if (ty === 'SurfaceOfRevolution') { const ax = ad.AxeOfRevolution(); const d = ax.Direction(); row.axis = [d.X(), d.Y(), d.Z()].map((x) => +x.toFixed(4)); }
        ad.delete();
      } catch (e) { row.typeErr = String(e).slice(0, 80); }
      rows.push(row);
    }
    const ballDev = (r: any) => r.ball?.dev ?? Infinity;
    const cls = (r: any) => (r.ana && r.ana.tol <= 1e-6 ? `analytic:${r.ana.type}` : ballDev(r) <= 1e-5 ? 'ball' : r.extruded ? 'extruded' : ballDev(r) <= 1e-4 ? 'ball~1e-4' : r.ana ? `analytic~1e-4:${r.ana.type}` : `other:${r.type}`);
    const summary: Record<string, { n: number; area: number }> = {};
    for (const r of rows) { const c = cls(r); r.cls = c; summary[c] = { n: (summary[c]?.n ?? 0) + 1, area: +((summary[c]?.area ?? 0) + r.area).toFixed(3) }; }
    appendFileSync(out, JSON.stringify({ rel, label, faces: topo.faces.length, odd: odd.length, summary, rows }) + String.fromCharCode(10));
    trace(`${rel} ${label} done ${JSON.stringify(summary)}`);
    kernel.release(id);
  }
}, 1_800_000);
