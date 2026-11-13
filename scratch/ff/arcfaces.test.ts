// The residual faces shaped like rounds (rational, 3 poles in one direction) that are not rolling balls: are their sections in that direction circle arcs,
// is the radius constant along the face, and which neighbours (any edge, smooth or not) are they tangent to? FILE/LABELS as residual.test.ts.
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';

const ANALYTIC = new Set(['plane', 'cylinder', 'cone', 'sphere', 'torus']);
type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V) => Math.hypot(...a);
/** circle through three points: centre and radius */
function circle(a: V, b: V, c: V) {
  const ab = sub(b, a), ac = sub(c, a), n = cross(ab, ac), nn = dot(n, n);
  if (nn < 1e-30) return null;
  const t1 = cross(n, ab).map((x) => (x * dot(ac, ac)) / (2 * nn)) as V, t2 = cross(ac, n).map((x) => (x * dot(ab, ab)) / (2 * nn)) as V;
  const o: V = [a[0] + t1[0] + t2[0], a[1] + t1[1] + t2[1], a[2] + t1[2] + t2[2]];
  return { o, r: len(sub(a, o)) };
}

it('arc-shaped residual faces', async () => {
  const dir = process.env.STEP_DIR!, rel = process.env.FILE!, out = process.env.OUT!, want: string[] = JSON.parse(process.env.LABELS ?? '["whole"]');
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const whole = new Uint8Array(readFileSync(join(dir, rel)));
  let targets: { label: string; bytes: Uint8Array }[];
  try {
    const parts = stepAssemblyPlan(kernel, whole).prototypes.filter((p: any) => p.part);
    targets = parts.length > 1 ? parts.map((p: any, i: number) => ({ label: `part-${i + 1}`, bytes: p.part.step })) : [{ label: 'whole', bytes: whole }];
  } catch { targets = [{ label: 'whole', bytes: whole }]; }
  const res = new Map<string, any>();
  for (const l of readFileSync('scratch/ff/residual.jsonl', 'utf8').trim().split(/\n/)) { const r = JSON.parse(l); res.set(`${r.rel}|${r.label}`, r); }
  for (const { label, bytes } of targets.filter((t) => want.includes(t.label))) {
    const prior = res.get(`${rel}|${label}`);
    const pick = prior.rows.filter((x: any) => x.cls.startsWith('other') && x.rational && (x.poles[0] === 3 || x.poles[1] === 3)).map((x: any) => x.face);
    const id = kernel.importStep(bytes).shape;
    const topo = kernel.topology(id);
    const faces: any[] = [];
    for (const ex = new oc.TopExp_Explorer(k.get(id), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
    const rows: any[] = [];
    for (const i of pick) {
      const ad = new oc.BRepAdaptor_Surface(faces[i], true);
      const h = ad.BSpline(); const s = h.get ? h.get() : h;
      const arcU = s.NbUPoles() === 3; // the arc runs along u when u has the 3 poles
      const [u0, u1, v0, v1] = [ad.FirstUParameter(), ad.LastUParameter(), ad.FirstVParameter(), ad.LastVParameter()];
      const P = (u: number, v: number): V => { const p = ad.Value(u, v); const o: V = [p.X(), p.Y(), p.Z()]; p.delete(); return o; };
      const radii: number[] = []; let spread = 0;
      for (let j = 0; j <= 8; j++) {
        const t = (arcU ? v0 + ((v1 - v0) * j) / 8 : u0 + ((u1 - u0) * j) / 8);
        const at = (x: number) => (arcU ? P(u0 + (u1 - u0) * x, t) : P(t, v0 + (v1 - v0) * x));
        const c = circle(at(0), at(0.5), at(1));
        if (!c) { radii.push(NaN); continue; }
        for (const x of [0.25, 0.75]) spread = Math.max(spread, Math.abs(len(sub(at(x), c.o)) - c.r));
        radii.push(c.r);
      }
      // neighbours and whether the face is tangent to each along their shared edge (normals at the edge's middle)
      const nbs: any[] = [];
      topo.edges.forEach((e, j) => {
        if (!e.faces.includes(i)) return;
        for (const g of e.faces) if (g !== i) nbs.push({ g, surf: topo.faces[g]!.surface, odd: !(ANALYTIC.has(topo.faces[g]!.surface) && topo.faces[g]!.geometry), edge: j });
      });
      const smooth = kernel.smoothEdges(id, nbs.map((n) => n.edge));
      nbs.forEach((n, m) => (n.smooth = smooth[m]));
      rows.push({ face: i, arcDir: arcU ? 'u' : 'v', rMin: Math.min(...radii), rMax: Math.max(...radii), circleSpread: spread, nbs: nbs.map((n) => `${n.g}${n.odd ? '*' : ''}:${n.surf}${n.smooth ? '~' : ''}`) });
      ad.delete();
    }
    appendFileSync(out, JSON.stringify({ rel, label, rows }) + String.fromCharCode(10));
    kernel.release(id);
  }
}, 1_800_000);
