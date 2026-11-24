// Probe: every rolling-ball fuzz seed's input round made on the body cut at its C1/C0 joints (ShapeUpgrade_ShapeDivideContinuity, C2 criteria), with
// Kernel.fillet's own checks (all three shapes, BRepCheck, tolerance gate) applied by hand: outcome, time, faces and edges added by the cut, and the
// volume against the uncut round where that one is made. Writes out/prof46/split100.json.
import { writeFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { Kernel, KernelError } from '@3db/kernel';
import { sample, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';

it('every seed', async () => {
  const k = await Kernel.load(); const oc = k.oc as any; const rows: any[] = [];
  const skip = new Set((process.env.SLOW ?? '96,91,95,53,68').split(',').map(Number)); // the uncut round of these takes 10-75 s a shape; known to fail
  for (let seed = 1; seed <= 100; seed++) {
    const s = sample(seed); const m = splineBoss(k, s.top, s.h);
    const before = k.topology(m.shape);
    let plain: number | string = 'skipped';
    let t0 = performance.now();
    if (!skip.has(seed)) {
      try { const r = k.fillet(m.shape, m.edges, s.radius); plain = k.massProps(r.shape).volume; k.release(r.shape); } catch (e) { if (!(e instanceof KernelError)) throw e; plain = 'refused'; }
    }
    const plainS = (performance.now() - t0) / 1000;
    // the edge, followed through the cut by where its pieces lie: on the cap (z = 0) and on the wall
    const div = new oc.ShapeUpgrade_ShapeDivideContinuity((k as any).get(m.shape));
    div.SetBoundaryCriterion(oc.GeomAbs_Shape.GeomAbs_C2); div.SetPCurveCriterion(oc.GeomAbs_Shape.GeomAbs_C2); div.SetSurfaceCriterion(oc.GeomAbs_Shape.GeomAbs_C2);
    div.Perform(true);
    const split = (k as any).put(div.Result()); div.delete();
    const ts = k.topology(split);
    const cap = ts.faces.findIndex((f) => f.geometry?.type === 'plane' && Math.abs(f.center[2]) < 1e-6 && f.normal?.[2] > 0.9);
    const walls = ts.faces.flatMap((f, i) => (!f.geometry || f.geometry.type !== 'plane' ? [i] : []));
    const edges = ts.edges.flatMap((e, i) => (e.faces.includes(cap) && e.faces.some((q) => walls.includes(q)) ? [i] : []));
    t0 = performance.now();
    let cut: number | string;
    try { const r = k.fillet(split, edges, s.radius); cut = k.massProps(r.shape).volume; k.release(r.shape); } catch (e) { if (!(e instanceof KernelError)) throw e; cut = 'refused'; }
    const cutS = (performance.now() - t0) / 1000;
    rows.push({ seed, r: s.radius, plain, plainS: +plainS.toFixed(2), cut, cutS: +cutS.toFixed(2), faces: [before.faces.length, ts.faces.length], edges: [before.edges.length, ts.edges.length], filletEdges: edges.length });
    k.release(split); k.release(m.shape);
  }
  writeFileSync('out/prof46/split100.json', JSON.stringify(rows, null, 1));
  expect(rows.length).toBe(100);
}, 1_800_000);
