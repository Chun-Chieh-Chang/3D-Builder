// C4 feasibility: part-4's blockers along z once rounds/chamfers are set aside — what kind of features are they?
import { appendFileSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';
const log = (m: string) => { appendFileSync('scratch/ff/c4d.log', m + String.fromCharCode(10)); };
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const unit = (a: number[]) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
const par = (a: number[], b: number[], tol = 1e-9) => Math.abs(Math.abs(dot(unit(a), unit(b))) - 1) <= tol;
const MAXD = (30 * Math.PI) / 180;
it('c4d', async () => {
  const kernel = await Kernel.load();
  const whole = new Uint8Array(readFileSync('D:/3DB實機確認/組合圖(R1-10226+R1-10134).STEP'));
  const id = kernel.importStep(stepAssemblyPlan(kernel, whole).prototypes.filter((p: any) => p.part)[3]!.part!.step).shape;
  const topo = kernel.topology(id);
  const smooth = kernel.smoothEdges(id, topo.edges.map((_, i) => i));
  // crude round test: a cylinder/torus/sphere/odd face with >= 2 smooth neighbours
  const nb = topo.faces.map(() => new Map<number, boolean>());
  topo.edges.forEach((e, ei) => { const fs = [...new Set(e.faces)]; if (fs.length === 2) { for (const [a, b] of [[fs[0]!, fs[1]!], [fs[1]!, fs[0]!]]) nb[a]!.set(b, (nb[a]!.get(b) ?? false) || smooth[ei]!); } });
  const roundish = (i: number) => { const g: any = topo.faces[i]!.geometry; return (!g || ['cylinder', 'torus', 'sphere'].includes(g.type)) && [...nb[i]!.values()].filter(Boolean).length >= 2; };
  const d = [0, 0, 1];
  const rows: string[] = []; const by: Record<string, number> = {}; let area = 0;
  topo.faces.forEach((f, i) => {
    const g: any = f.geometry;
    if (roundish(i)) return;
    if (g?.type === 'plane' && par(g.normal, d)) return;
    if (g?.type === 'plane' && Math.asin(Math.min(1, Math.abs(dot(unit(g.normal), d)))) <= MAXD) return;
    if (g?.type === 'cylinder' && par(g.axis, d)) return;
    if (g?.type === 'cone' && par(g.axis, d) && Math.abs(g.halfAngle) <= MAXD) return;
    const ax = g?.type === 'plane' ? g.normal : g?.axis;
    const key = `${g?.type ?? 'odd'} ${ax ? unit(ax).map((x: number) => (Math.abs(x) < 5e-5 ? 0 : x).toFixed(3)).join(',') : ''}${g?.type === 'cone' ? ' half ' + ((g.halfAngle * 180) / Math.PI).toFixed(2) : ''}`;
    by[key] = (by[key] ?? 0) + 1; area += f.area;
    rows.push(`#${i + 1} ${key} area ${f.area.toFixed(2)} at ${f.center.map((x) => x.toFixed(1))}`);
  });
  log(`blockers along z (not round-like): ${rows.length}, area ${area.toFixed(1)} of ${topo.faces.reduce((a, f) => a + f.area, 0).toFixed(1)}`);
  for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) log(`${v} × ${k}`);
  const b = kernel.bounds(id); log(`bounds ${JSON.stringify(b)}`); log(`volume ${kernel.massProps(id).volume}`);
}, 600_000);
