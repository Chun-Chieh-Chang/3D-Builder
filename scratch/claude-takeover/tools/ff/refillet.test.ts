import { readFileSync, appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel, KernelError } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';
const D = process.env.STEP_DIR!;
const log = (m: string) => appendFileSync('/tmp/refillet.log', m + '\n');
const circum = (a: number[], b: number[], c: number[]) => { const ab = Math.hypot(...a.map((x, i) => x - b[i]!)), bc = Math.hypot(...b.map((x, i) => x - c[i]!)), ca = Math.hypot(...c.map((x, i) => x - a[i]!)); const s = (ab + bc + ca) / 2; const A = Math.sqrt(Math.max(0, s * (s - ab) * (s - bc) * (s - ca))); return A > 1e-12 ? (ab * bc * ca) / (4 * A) : Infinity; };
it('refillets', async () => {
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const [rel, part] = JSON.parse(process.env.TARGET!);
  let bytes = new Uint8Array(readFileSync(`${D}/${rel}`));
  if (part !== null) bytes = stepAssemblyPlan(kernel, bytes).prototypes.filter((p: any) => p.part)[part]!.part!.step;
  const imp = kernel.importStep(bytes); const shape = k.get(imp.shape);
  const topo = kernel.topology(imp.shape);
  const mass0 = kernel.massProperties ? (kernel as any).massProperties(imp.shape) : null;
  let fi = 0; const cands: { face: number; r: number; spread: number }[] = [];
  for (const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next(), fi++) {
    const ad = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(ex.Current()), true);
    if (String(ad.GetType()).replace('GeomAbs_', '') !== 'BSplineSurface') continue;
    const u0 = ad.FirstUParameter(), u1 = ad.LastUParameter(), v0 = ad.FirstVParameter(), v1 = ad.LastVParameter();
    const P = (u: number, v: number) => { const p = ad.Value(u, v); return [p.X(), p.Y(), p.Z()]; };
    // circular cross-sections in either parameter direction, the same radius all along
    for (const dirn of ['v', 'u']) {
      const rs: number[] = [];
      for (let s = 0; s <= 8; s++) {
        const t = s / 8;
        const pts = [0, 0.37, 0.71, 1].map((w) => (dirn === 'v' ? P(u0 + (u1 - u0) * t, v0 + (v1 - v0) * w) : P(u0 + (u1 - u0) * w, v0 + (v1 - v0) * t)));
        const r1 = circum(pts[0]!, pts[1]!, pts[2]!), r2 = circum(pts[1]!, pts[2]!, pts[3]!);
        rs.push(r1, r2);
      }
      const r = rs.reduce((a, b) => a + b, 0) / rs.length; const spread = Math.max(...rs) - Math.min(...rs);
      if (Number.isFinite(r) && spread < 1e-6 * Math.max(1, r)) { cands.push({ face: fi, r, spread }); break; }
    }
  }
  log(`${rel} ${part}: ${cands.length} constant-radius circular-section faces of ${fi}: radii ${[...new Set(cands.map((c) => c.r.toFixed(6)))].join(',')}`);
  const vol = (id: number) => kernel.massProps(id).volume;
  const V0 = vol(imp.shape);
  const byR = new Map<string, number[]>(); for (const c of cands) { const key = c.r.toFixed(6); byR.set(key, [...(byR.get(key) ?? []), c.face]); }
  const MAXR = Number(process.env.MAXR ?? 5);
  for (let k2 = cands.length - 1; k2 >= 0; k2--) if (cands[k2]!.r > MAXR) cands.splice(k2, 1);
  const radii = [...new Set(cands.map((c) => c.r))];
  // the analytic pieces of the same chains: rounds (cylinder/torus) of one of these radii, joined smoothly to a chain
  const inChain = new Set(cands.map((c) => c.face));
  const smoothAll = kernel.smoothEdges(imp.shape, topo.edges.map((_, i) => i));
  let grew = true;
  while (grew) { grew = false; topo.faces.forEach((f, i) => { if (inChain.has(i)) return; const g: any = f.geometry; const r = g?.type === 'torus' ? g.minor : g?.type === 'cylinder' ? g.radius : null; if (r === null || !radii.some((x) => Math.abs(x - r) < 1e-6)) return;
    const touches = topo.edges.some((e, ei) => smoothAll[ei] && e.faces.includes(i) && e.faces.some((n) => n !== i && inChain.has(n))); if (touches) { inChain.add(i); cands.push({ face: i, r, spread: 0 }); grew = true; } }); }
  const all = [...inChain];
  log(`  chain faces ${all.length} (b-spline ${all.length - cands.filter((c) => c.spread === 0).length})`);
  try {
    const t0 = performance.now();
    const del = kernel.deleteFaces(imp.shape, all);
    const t1 = kernel.topology(del.shape);
    log(`  deleted all ${all.length} in ${Math.round(performance.now() - t0)}ms; faces ${topo.faces.length} -> ${t1.faces.length}; valid ${kernel.check(del.shape).valid}`);
    // which new sharp edges come from which removed face: nearest removed-face sample
    const oldMids = topo.edges.map((e) => e.mid);
    const fresh = t1.edges.flatMap((e, i) => (oldMids.some((m) => Math.hypot(m[0] - e.mid[0], m[1] - e.mid[1], m[2] - e.mid[2]) < 1e-7) ? [] : [i]));
    const sm = kernel.smoothEdges(del.shape, fresh);
    const sharp = fresh.filter((_, j) => !sm[j]);
    log(`  fresh edges ${fresh.length}, sharp ${sharp.length}: ${[...new Set(sharp.map((i) => t1.edges[i]!.curve))].join('/')}`);
    // radius for each sharp edge: the removed face whose centre is nearest the edge midpoint
    const radiusOf = (ei: number) => { const m = t1.edges[ei]!.mid; let best = Infinity, r = 0; for (const c of cands) { const f = topo.faces[c.face]!; const d = Math.hypot(...f.center.map((x, i) => x - m[i]!)); if (d < best) { best = d; r = c.r; } } return r; };
    const groups = new Map<string, number[]>(); for (const e of sharp) { const k2 = radiusOf(e).toFixed(6); groups.set(k2, [...(groups.get(k2) ?? []), e]); }
    let cur = del.shape; const V0 = vol(imp.shape), A0 = kernel.massProps(imp.shape).area;
    const order = [...groups.entries()].sort((x, y) => Number(y[0]) - Number(x[0]));
    for (const [r, es] of order) {
      // edge indices change after each fillet: find the same edges again by midpoint
      const tc = kernel.topology(cur); const mids = es.map((e) => t1.edges[e]!.mid);
      const idx = tc.edges.flatMap((e, i) => (mids.some((m) => Math.hypot(m[0] - e.mid[0], m[1] - e.mid[1], m[2] - e.mid[2]) < 1e-6) ? [i] : []));
      const f = kernel.fillet(cur, idx, Number(r)); log(`  fillet r=${r} on ${idx.length}/${es.length} edges ok`); cur = f.shape;
    }
    const V1 = vol(cur), A1 = kernel.massProps(cur).area;
    log(`  RESULT V0=${V0.toFixed(6)} V1=${V1.toFixed(6)} relV=${(Math.abs(V1 - V0) / V0).toExponential(2)}  A0=${A0.toFixed(5)} A1=${A1.toFixed(5)} relA=${(Math.abs(A1 - A0) / A0).toExponential(2)} faces ${kernel.topology(cur).faces.length}/${topo.faces.length}`);
  } catch (e) { if (!(e instanceof KernelError)) throw e; log('  failed: ' + String(e).slice(0, 300)); }
}, 900000);
