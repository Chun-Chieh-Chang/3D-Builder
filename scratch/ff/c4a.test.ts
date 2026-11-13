// C4 feasibility on part-4: what recognition says now, and with the 5 odd faces and all rounds set aside, how many analytic faces block each direction.
import { appendFileSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { recognize, RecognizeError } from '../../packages/regen/src/recognize';
import { frameFor } from '../../packages/regen/src/recognize/reconstruct';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';
const log = (m: string) => { appendFileSync('scratch/ff/c4a.log', m + String.fromCharCode(10)); console.log(m); };
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const unit = (a: number[]) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
const par = (a: number[], b: number[], tol = 1e-9) => Math.abs(Math.abs(dot(unit(a), unit(b))) - 1) <= tol;
const MAXD = (30 * Math.PI) / 180;
it('c4a', async () => {
  const kernel = await Kernel.load();
  const whole = new Uint8Array(readFileSync('D:/3DB實機確認/組合圖(R1-10226+R1-10134).STEP'));
  const id = kernel.importStep(stepAssemblyPlan(kernel, whole).prototypes.filter((p: any) => p.part)[3]!.part!.step).shape;
  const topo = kernel.topology(id);
  log(`faces ${topo.faces.length}`);
  const t0 = performance.now();
  const rounds: any = {};
  try { recognize(kernel, id, frameFor as any, undefined, undefined, rounds); log('recognized'); } catch (e) { log(`${e instanceof RecognizeError ? 'refused' : 'ERROR'}: ${String((e as Error).message).slice(0, 400)}`); }
  log(`ms ${Math.round(performance.now() - t0)} nominated ${rounds.nominated}`);
  const types: Record<string, number> = {};
  topo.faces.forEach((f) => { const k = f.geometry ? f.geometry.type : `odd:${f.surface}`; types[k] = (types[k] ?? 0) + 1; });
  log(JSON.stringify(types));
  // candidate directions: canonical, plane normals, cylinder and cone axes
  const cands: number[][] = [[0, 1, 0], [0, 0, 1], [1, 0, 0]];
  const add = (d: number[]) => { if (!cands.some((c) => par(c, d, 1e-7))) cands.push(unit(d)); };
  topo.faces.forEach((f) => { const g: any = f.geometry; if (g?.type === 'plane') add(g.normal); if (g?.type === 'cylinder' || g?.type === 'cone') add(g.axis); });
  log(`candidate directions ${cands.length}`);
  const lean = (f: any, d: number[]): number | null => {
    const g = f.geometry;
    if (g?.type === 'plane') { if (par(g.normal, d)) return null; const l = Math.asin(Math.min(1, Math.abs(dot(unit(g.normal), unit(d))))); return l <= MAXD + 1e-12 ? l : null; }
    if (g?.type === 'cylinder') return par(g.axis, d) ? 0 : null;
    if (g?.type === 'cone') return par(g.axis, d) && Math.abs(g.halfAngle) <= MAXD + 1e-12 ? Math.abs(g.halfAngle) : null;
    return null;
  };
  const rows = cands.map((d) => {
    const by: Record<string, number> = {}; let n = 0; let caps = 0; let walls = 0;
    topo.faces.forEach((f) => {
      const g: any = f.geometry; if (!g) return;
      if (g.type === 'plane' && par(g.normal, d)) { caps++; return; }
      if (lean(f, d) !== null) { walls++; return; }
      n++; by[g.type] = (by[g.type] ?? 0) + 1;
    });
    return { d: d.map((x) => +x.toFixed(5)), block: n, caps, walls, by };
  }).sort((a, b) => a.block - b.block);
  for (const r of rows.slice(0, 12)) log(JSON.stringify(r));
}, 900_000);
