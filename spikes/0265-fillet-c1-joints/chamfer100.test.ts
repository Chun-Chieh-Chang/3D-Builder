/**
 * ADR 0265 §7.3 (2026-11-26): does a chamfer across a sketch spline's C1 joints fail or take long, as the fillet did? Every rolling-ball fuzz seed's
 * boss (the same part as `split100.test.ts`), its spline wall's bottom edges chamfered at the seed's radius (distance-distance, equal), on the body
 * as it is and on the body cut at its joints below C2. One line per seed, written before and after each chamfer (a stall shows where it is).
 * The volume each removes is set beside d²/2 times the edges' length (a wall square to the cap; the corners where the spline meets the flat walls
 * add a little). Writes spikes/0265-fillet-c1-joints/data/chamfer100.jsonl. SEEDS (a-b) narrows the run.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Kernel, KernelError, type ShapeId } from '@3db/kernel';
import { sample, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';

const OUT = 'spikes/0265-fillet-c1-joints/data/chamfer100.jsonl';
const [FROM, TO] = (process.env.SEEDS ?? '1-100').split('-').map(Number) as [number, number];

it('every seed', async () => {
  const k = await Kernel.load();
  const oc = k.oc as any;
  writeFileSync(OUT, '');
  let n = 0;
  for (let seed = FROM; seed <= TO; seed++) {
    const s = sample(seed);
    const m = splineBoss(k, s.top, s.h);
    const chamfer = (shape: ShapeId, edges: number[]) => {
      const topo = k.topology(shape);
      const t0 = performance.now();
      appendFileSync(OUT, JSON.stringify({ seed, start: true, edges: edges.length }) + '\n');
      try {
        const r = k.chamfer(shape, edges.map((edge) => ({ edge, face: topo.edges[edge]!.faces[0]! })), 'distanceDistance', s.radius, s.radius);
        const v = k.massProps(r.shape).volume;
        k.release(r.shape);
        return { ok: true, v, s: +((performance.now() - t0) / 1000).toFixed(2) };
      } catch (e) {
        if (!(e instanceof KernelError)) throw e;
        return { ok: false, why: e.message.slice(0, 60), s: +((performance.now() - t0) / 1000).toFixed(2) };
      }
    };
    const base = k.massProps(m.shape).volume;
    const topo0 = k.topology(m.shape);
    const length = m.edges.reduce((t, e) => t + topo0.edges[e]!.length, 0);
    const plain = chamfer(m.shape, m.edges);
    const div = new oc.ShapeUpgrade_ShapeDivideContinuity((k as any).get(m.shape));
    div.SetBoundaryCriterion(oc.GeomAbs_Shape.GeomAbs_C2); div.SetPCurveCriterion(oc.GeomAbs_Shape.GeomAbs_C2); div.SetSurfaceCriterion(oc.GeomAbs_Shape.GeomAbs_C2);
    div.Perform(true);
    const split: ShapeId = (k as any).put(div.Result());
    div.delete();
    const ts = k.topology(split);
    const cap = ts.faces.findIndex((f) => f.geometry?.type === 'plane' && Math.abs(f.center[2]) < 1e-6 && (f.normal?.[2] ?? 0) > 0.9);
    const walls = ts.faces.flatMap((f, i) => (!f.geometry || f.geometry.type !== 'plane' ? [i] : []));
    const cutEdges = ts.edges.flatMap((e, i) => (e.faces.includes(cap) && e.faces.some((q) => walls.includes(q)) ? [i] : []));
    const cut = chamfer(split, cutEdges);
    appendFileSync(OUT, JSON.stringify({ seed, r: s.radius, removed: { plain: plain.ok ? base - plain.v! : null, cut: cut.ok ? base - cut.v! : null, ideal: 0.5 * s.radius * s.radius * length }, plain, cut, rel: plain.ok && cut.ok ? Math.abs(plain.v! - cut.v!) / plain.v! : null }) + '\n');
    k.release(split);
    k.release(m.shape);
    n++;
  }
  expect(n).toBe(TO - FROM + 1);
}, 3_600_000);
