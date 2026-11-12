import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';
import { measure } from './rb-measure';
// C2.11a: what the corners of the real parts' rounds are. A round: a B-spline face whose section is a constant-radius arc (measure), a torus or a
// cylinder of radius <= 5 smooth to two faces. A corner patch: a face that is no round, all its edges smooth, touching two or more rounds.
it('corners', async () => {
  const kernel = await Kernel.load();
  const [rel, part] = JSON.parse(process.env.TARGET!);
  let bytes = new Uint8Array(readFileSync(`${process.env.STEP_DIR}/${rel}`));
  if (part !== null) bytes = stepAssemblyPlan(kernel, bytes).prototypes.filter((p: any) => p.part)[part]!.part!.step;
  const imp = kernel.importStep(bytes);
  const t = kernel.topology(imp.shape);
  const smooth = kernel.smoothEdges(imp.shape, t.edges.map((_, i) => i));
  const m = measure(kernel, imp, rel, part);
  const nbS = (f: number) => [...new Set(t.edges.flatMap((e, i) => (smooth[i] && e.faces.includes(f) ? e.faces.filter((n) => n !== f) : [])))];
  const r = new Map<number, number>();
  for (const it of m.items) if (it.r) r.set(it.face, it.r);
  t.faces.forEach((f, i) => { const g: any = f.geometry; if (g?.type === 'torus' && g.minor <= 5) r.set(i, g.minor); if (g?.type === 'cylinder' && g.radius <= 5 && nbS(i).length >= 2) r.set(i, g.radius); });
  const isRound = (i: number) => r.has(i);
  const patches = t.faces.flatMap((f, i) => { if (isRound(i)) return []; const es = t.edges.map((e, k) => k).filter((k) => t.edges[k]!.faces.includes(i)); const rn = nbS(i).filter(isRound); return es.length && es.every((k) => smooth[k]) && rn.length >= 2 ? [{ face: i, surf: f.surface, geom: (f.geometry as any)?.type === 'sphere' ? { R: (f.geometry as any).radius } : undefined, area: +f.area.toFixed(4), rounds: rn.map((n) => ({ n, s: t.faces[n]!.surface, r: r.get(n) })) }] : []; });
  // rounds meeting rounds across smooth edges
  const rr = t.edges.flatMap((e, k) => (smooth[k] && e.faces.length === 2 && e.faces.every(isRound) ? [{ e: k, a: e.faces[0], b: e.faces[1], sa: t.faces[e.faces[0]!]!.surface, sb: t.faces[e.faces[1]!]!.surface, ra: r.get(e.faces[0]!), rb: r.get(e.faces[1]!), curve: e.curve }] : []));
  // rounds meeting each other across sharp edges (a setback or a mitre)
  const rs = t.edges.flatMap((e, k) => (!smooth[k] && e.faces.length === 2 && e.faces.every(isRound) ? [{ e: k, a: e.faces[0], b: e.faces[1], sa: t.faces[e.faces[0]!]!.surface, sb: t.faces[e.faces[1]!]!.surface, ra: r.get(e.faces[0]!), rb: r.get(e.faces[1]!), curve: e.curve, L: e.length }] : []));
  const bsRounds = [...r.keys()].filter((i) => !['torus', 'cylinder'].includes(t.faces[i]!.surface));
  const supCount = bsRounds.map((i) => ({ i, sup: nbS(i).filter((n) => !isRound(n)).length, roundNb: nbS(i).filter(isRound).length }));
  writeFileSync(process.env.OUT!, JSON.stringify({ rel, part, faces: t.faces.length, rounds: r.size, bsplineRounds: bsRounds.length, patches, roundRoundSmooth: rr, roundRoundSharp: rs, supCount }, null, 1));
}, 600000);
