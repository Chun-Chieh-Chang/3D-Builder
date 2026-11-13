// After C4-1: what the faces left with no simple surface are, per refused real part (scoping the next step). Each face with no simple surface that is
// not read as one (Kernel.analyticFace at max(1e-6, τ_f), as recognition does) is put in the first class that fits:
//   round   — a rolling ball between some pair of smoothly joined neighbours, within max(1e-5, 1e-3·r, 2τ_f) (as recognition nominates)
//   wall    — straight along some direction the body offers (canonical axes, plane normals, cylinder/cone axes; faceRuledAlong, 1e-6 on the normal)
//   other   — none of these: surface type, degrees, poles, area
// FILE = path under D:/3DB實機確認, LABEL = target label ('whole' or 'part-N').
import { appendFileSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';

const log = (m: string) => appendFileSync('scratch/ff/c4q.log', m + String.fromCharCode(10));
const trace = (m: string) => appendFileSync('scratch/ff/c4q.trace', `${new Date().toISOString().slice(11, 19)} ${m}\n`);

it('residual after C4-1', async () => {
  const rel = process.env.FILE!, want = process.env.LABEL ?? 'whole';
  const kernel = await Kernel.load();
  const oc = (kernel as any).oc;
  const whole = new Uint8Array(readFileSync(`D:/3DB實機確認/${rel}`));
  let bytes = whole;
  if (want !== 'whole') {
    const parts = stepAssemblyPlan(kernel, whole).prototypes.filter((p: any) => p.part);
    bytes = parts[Number(want.split('-')[1]) - 1]!.part!.step;
  }
  const id = kernel.importStep(bytes).shape;
  const topo = kernel.topology(id);
  const tau = kernel.fileTolerance(id).faces;
  const smooth = kernel.smoothEdges(id, topo.edges.map((_, i) => i));
  const nb = topo.faces.map(() => new Set<number>());
  topo.edges.forEach((e, ei) => {
    const fs = [...new Set(e.faces)];
    if (fs.length === 2 && smooth[ei]) { nb[fs[0]!]!.add(fs[1]!); nb[fs[1]!]!.add(fs[0]!); }
  });
  const unit = (a: number[]) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
  const dirs: number[][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const add = (d: number[]) => { const u = unit(d); if (!dirs.some((x) => Math.abs(Math.abs(x[0]! * u[0]! + x[1]! * u[1]! + x[2]! * u[2]!) - 1) < 1e-9)) dirs.push(u); };
  topo.faces.forEach((f) => { const g: any = f.geometry; if (g?.type === 'plane') add(g.normal); if (g?.type === 'cylinder' || g?.type === 'cone') add(g.axis); });
  const odd = topo.faces.flatMap((f, i) => (f.geometry ? [] : [i]));
  trace(`${rel} ${want}: ${topo.faces.length} faces, ${odd.length} odd, ${dirs.length} dirs`);
  const cls: Record<string, { n: number; area: number; faces: string[] }> = {};
  const put = (k: string, i: number, what: string) => { const c = (cls[k] ??= { n: 0, area: 0, faces: [] }); c.n++; c.area += topo.faces[i]!.area; c.faces.push(`f${i} ${what}`); };
  for (const i of odd) {
    const t = Math.max(1e-6, tau[i] ?? 0);
    const a = kernel.analyticFace(id, i, t);
    if (a) { put('analytic (C4-1)', i, a.geometry.type); continue; }
    const sup = [...nb[i]!].filter((n) => topo.faces[n]!.geometry);
    let ball: string | null = null;
    for (let x = 0; x < sup.length && !ball; x++) for (let y = x + 1; y < sup.length && !ball; y++) {
      const r = kernel.rollingBall(id, i, [sup[x]!, sup[y]!], Infinity);
      if (r && r.deviation <= Math.max(1e-5, 1e-3 * r.radius, 2 * (tau[i] ?? 0))) ball = `r ${r.radius.toFixed(3)} dev ${r.deviation.toExponential(1)}`;
    }
    if (ball) { put('round (C2.8)', i, ball); continue; }
    const along = dirs.filter((d) => kernel.faceRuledAlong(id, i, d as any));
    if (along.length) { put('wall', i, `along (${along[0]!.map((x) => x.toFixed(3))})`); continue; }
    const ad = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(new oc.TopExp_Explorer((kernel as any).get(id), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE).Current()), true);
    ad.delete();
    put(`other ${topo.faces[i]!.surface}`, i, `area ${topo.faces[i]!.area.toFixed(2)} τ ${(tau[i] ?? 0).toExponential(1)} smooth-nb ${nb[i]!.size}`);
  }
  log(`== ${rel} ${want}: ${topo.faces.length} faces, ${odd.length} with no simple surface`);
  for (const [k, v] of Object.entries(cls)) log(`  ${k}: ${v.n} faces, ${v.area.toFixed(1)} mm² — ${v.faces.slice(0, 8).join('; ')}${v.faces.length > 8 ? ' …' : ''}`);
  trace(`${rel} ${want} done`);
}, 900_000);
