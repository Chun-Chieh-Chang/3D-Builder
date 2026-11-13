// C5 feasibility on part-3 (R1-10226). C5MODE=regions: the faces with no simple surface that recognition cannot read (not analytic within
// max(1e-6, τ_f), not a rolling ball, not a wall along a body direction — as c4q) grouped into connected regions, with their neighbours; written to
// scratch/ff/c5-regions.json. C5MODE=delete REGION=k: Kernel.deleteFaces on region k alone (each in its own process: the call may not return), then what
// is left: valid, volume change, faces with no simple surface still there. Trace before every step (AGENTS §4 2026-11-07).
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';

const log = (m: string) => appendFileSync('scratch/ff/c5a.log', m + String.fromCharCode(10));
const trace = (m: string) => appendFileSync('scratch/ff/c5a.trace', `${new Date().toISOString().slice(11, 19)} ${m}\n`);
const FILE = 'D:/3DB實機確認/組合圖(R1-10226+R1-10134).STEP';

export function part3(kernel: Kernel) {
  const parts = stepAssemblyPlan(kernel, new Uint8Array(readFileSync(FILE))).prototypes.filter((p: any) => p.part);
  return kernel.importStep(parts[2]!.part!.step).shape;
}

it('c5a', async () => {
  const kernel = await Kernel.load();
  const heap = () => ((kernel.oc as any).wasmMemory.buffer.byteLength / 2 ** 20).toFixed(0);
  trace(`start ${process.env.C5MODE} ${process.env.REGION ?? ''}`);
  const id = part3(kernel);
  const topo = kernel.topology(id);
  if (process.env.C5MODE === 'regions') {
    const tau = kernel.fileTolerance(id).faces;
    const smooth = kernel.smoothEdges(id, topo.edges.map((_, i) => i));
    const adj = topo.faces.map(() => new Set<number>());
    const sm = topo.faces.map(() => new Set<number>());
    topo.edges.forEach((e, ei) => {
      const fs = [...new Set(e.faces)];
      if (fs.length !== 2) return;
      adj[fs[0]!]!.add(fs[1]!); adj[fs[1]!]!.add(fs[0]!);
      if (smooth[ei]) { sm[fs[0]!]!.add(fs[1]!); sm[fs[1]!]!.add(fs[0]!); }
    });
    const unit = (a: number[]) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
    const dirs: number[][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const add = (d: number[]) => { const u = unit(d); if (!dirs.some((x) => Math.abs(Math.abs(x[0]! * u[0]! + x[1]! * u[1]! + x[2]! * u[2]!) - 1) < 1e-9)) dirs.push(u); };
    topo.faces.forEach((f) => { const g: any = f.geometry; if (g?.type === 'plane') add(g.normal); if (g?.type === 'cylinder' || g?.type === 'cone') add(g.axis); });
    const kind: string[] = topo.faces.map((f) => (f.geometry ? f.geometry.type : ''));
    const other: number[] = [];
    topo.faces.forEach((f, i) => {
      if (f.geometry) return;
      const t = Math.max(1e-6, tau[i] ?? 0);
      const a = kernel.analyticFace(id, i, t);
      if (a) { kind[i] = `as-${a.geometry.type}`; return; }
      const sup = [...sm[i]!].filter((n) => topo.faces[n]!.geometry);
      for (let x = 0; x < sup.length; x++) for (let y = x + 1; y < sup.length; y++) {
        const r = kernel.rollingBall(id, i, [sup[x]!, sup[y]!], Infinity);
        if (r && r.deviation <= Math.max(1e-5, 1e-3 * r.radius, 2 * (tau[i] ?? 0))) { kind[i] = 'ball'; return; }
      }
      if (dirs.some((d) => kernel.faceRuledAlong(id, i, d as any))) { kind[i] = 'wall'; return; }
      kind[i] = 'other';
      other.push(i);
    });
    // connected regions of 'other' faces
    const seen = new Set<number>();
    const regions: { faces: number[]; area: number; neighbours: Record<string, number>; box: number[][]; tau: number }[] = [];
    for (const s of other) {
      if (seen.has(s)) continue;
      const stack = [s]; const faces: number[] = []; seen.add(s);
      while (stack.length) { const f = stack.pop()!; faces.push(f); for (const n of adj[f]!) if (kind[n] === 'other' && !seen.has(n)) { seen.add(n); stack.push(n); } }
      const nb: Record<string, number> = {};
      const ring = new Set<number>(); for (const f of faces) for (const n of adj[f]!) if (!faces.includes(n)) ring.add(n);
      for (const n of ring) nb[kind[n]!] = (nb[kind[n]!] ?? 0) + 1;
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const v of topo.vertices) if (v.faces.some((f) => faces.includes(f))) v.point.forEach((x, k) => { lo[k] = Math.min(lo[k]!, x); hi[k] = Math.max(hi[k]!, x); });
      regions.push({ faces: faces.sort((a, b) => a - b), area: faces.reduce((a, f) => a + topo.faces[f]!.area, 0), neighbours: nb, box: [lo, hi], tau: Math.max(...faces.map((f) => tau[f] ?? 0)) });
    }
    regions.sort((a, b) => b.area - a.area);
    writeFileSync('scratch/ff/c5-regions.json', JSON.stringify({ kinds: kind, regions }, null, 1));
    const count: Record<string, number> = {}; kind.forEach((k) => (count[k] = (count[k] ?? 0) + 1));
    log(`part-3: ${topo.faces.length} faces ${JSON.stringify(count)}; ${other.length} other in ${regions.length} regions; volume ${kernel.massProps(id).volume.toFixed(4)}`);
    regions.forEach((r, k) => log(`  region ${k}: ${r.faces.length} faces [${r.faces.join(',')}] area ${r.area.toFixed(2)} τ ${r.tau.toExponential(1)} neighbours ${JSON.stringify(r.neighbours)} box ${r.box.map((p) => p.map((x) => x.toFixed(2)).join(',')).join(' .. ')}`));
    trace('regions done');
    return;
  }
  // MODE=delete
  const { regions } = JSON.parse(readFileSync('scratch/ff/c5-regions.json', 'utf8'));
  const k = Number(process.env.REGION);
  const r = regions[k];
  const v0 = kernel.massProps(id).volume;
  trace(`region ${k}: deleteFaces on ${r.faces.length} faces, heap ${heap()}`);
  const t0 = performance.now();
  let out: string;
  try {
    const res = kernel.deleteFaces(id, r.faces);
    const ms = Math.round(performance.now() - t0);
    trace(`region ${k}: deleteFaces returned in ${ms} ms`);
    const t2 = kernel.topology(res.shape);
    const odd = t2.faces.filter((f) => !f.geometry).length;
    const v1 = kernel.massProps(res.shape, { eps: 1e-10 }).volume;
    out = `ok ${ms}ms valid ${kernel.check(res.shape).valid} faces ${topo.faces.length}->${t2.faces.length} odd ${topo.faces.filter((f) => !f.geometry).length}->${odd} volume ${(v1 - v0).toFixed(5)} mm³ (${((v1 - v0) / v0).toExponential(2)})`;
  } catch (e) {
    out = `refused ${Math.round(performance.now() - t0)}ms: ${String((e as Error).message).slice(0, 160)}`;
  }
  log(`region ${k} (${r.faces.length} faces, ${r.area.toFixed(2)} mm²): deleteFaces ${out}; heap ${heap()} MiB`);
  trace(`region ${k} done`);
}, 900_000);
