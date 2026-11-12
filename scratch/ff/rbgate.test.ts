// Calibrating the arc gate on real parts: for every non-analytic face of the targets in FILE (relative to STEP_DIR) with two smooth neighbours, the
// relative spread of its section circumradii (as arcSections reads them, both directions) and rollingBall's deviation with the gate taken off (tol 1).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';
import { Arena, ShapeIndex } from '../../packages/kernel/src/occt';
import * as RR from '../../packages/kernel/src/roundRecognition';

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(...a);
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const circum = (a: V3, b: V3, c: V3) => { const ar = len(cross(sub(b, a), sub(c, a))) / 2; return ar > 1e-14 ? (len(sub(a, b)) * len(sub(b, c)) * len(sub(c, a))) / (4 * ar) : Infinity; };

it('gate', async () => {
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const whole = new Uint8Array(readFileSync(join(process.env.STEP_DIR!, process.env.FILE!)));
  const parts = stepAssemblyPlan(kernel, whole).prototypes.filter((p: any) => p.part);
  const want = (process.env.PARTS ?? '').split(',').filter(Boolean).map(Number);
  for (const [pi, p] of parts.entries()) {
    if (want.length && !want.includes(pi + 1)) continue;
    const body = kernel.importStep((p as any).part.step).shape;
    const t = kernel.topology(body); const sm = kernel.smoothEdges(body, t.edges.map((_, i) => i));
    const nb = (f: number) => [...new Set(t.edges.flatMap((e, x) => (sm[x] && e.faces.includes(f) ? e.faces.filter((q) => q !== f) : [])))];
    const arena = new Arena(); const F = ShapeIndex.of(oc, k.get(body), oc.TopAbs_ShapeEnum.TopAbs_FACE, arena).keys;
    const rows: string[] = [];
    t.faces.forEach((f, i) => {
      if (['plane', 'cylinder', 'cone', 'sphere', 'torus'].includes(f.surface)) return;
      const n = nb(i);
      const face = oc.TopoDS.Face(F[i]);
      const ad = new oc.BRepAdaptor_Surface(face, true);
      const u0 = ad.FirstUParameter(), u1 = ad.LastUParameter(), v0 = ad.FirstVParameter(), v1 = ad.LastVParameter();
      const P = (u: number, v: number): V3 => { const q = ad.Value(u, v); const o: V3 = [q.X(), q.Y(), q.Z()]; q.delete(); return o; };
      const spread: Record<string, string> = {};
      for (const across of ['v', 'u']) {
        const rs: number[] = [];
        for (let s = 0; s <= 8; s++) { const tt = s / 8; const q = [0, 0.37, 0.71, 1].map((w) => (across === 'v' ? P(u0 + (u1 - u0) * tt, v0 + (v1 - v0) * w) : P(u0 + (u1 - u0) * w, v0 + (v1 - v0) * tt))); rs.push(circum(q[0]!, q[1]!, q[2]!), circum(q[1]!, q[2]!, q[3]!)); }
        const m = rs.reduce((a, b) => a + b, 0) / rs.length;
        spread[across] = `${m.toPrecision(5)}±${((Math.max(...rs) - Math.min(...rs)) / m).toExponential(1)}`;
      }
      ad.delete();
      let ball = '-';
      if (n.length === 2) { const b = RR.rollingBall(oc, face, oc.TopoDS.Face(F[n[0]!]), oc.TopoDS.Face(F[n[1]!]), 1); ball = b ? `r ${b.radius.toPrecision(5)} dev ${b.deviation.toExponential(2)}` : 'null'; }
      rows.push(`#${i} ${f.surface} nb ${n.length} arcs v ${spread.v} u ${spread.u} ball ${ball}`);
    });
    console.log(`GATE part-${pi + 1} ${rows.length} faces\n` + rows.map((r) => 'GATE   ' + r).join('\n'));
    arena.dispose();
  }
}, 900_000);
