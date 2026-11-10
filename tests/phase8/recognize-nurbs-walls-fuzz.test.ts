/**
 * Feature recognition of B-spline walls carried straight (C1), random parts (AGENTS §3.4): 120 plates with a random outline of clamped cubics (3 to 6
 * pieces, rational or not, one of them straight or not), with or without a hole, cut into the top or raised on it, walls as surfaces of extrusion or as
 * B-spline surfaces. Each must be refused with a RecognizeError or come back the same solid (checked by cutting each from the other, not by the code under
 * test), its sketches fully defined. A file of its own for a fresh Emscripten heap (AGENTS §3.5); the heap is read only through `wasmMemory.buffer.byteLength`
 * and its growth printed, not claimed to be zero. Booleans on B-spline bodies keep heap (AGENTS §3.5: about 33 MiB a part here, 2.3 MiB a section and 8.3 MiB a
 * cut measured alone, the same as before C1), so the 120 seeds are two files of 60, each with a heap of its own; FUZZ_FROM / FUZZ_TO narrow a run further.
 */
import { beforeAll, expect, it } from 'vitest';
import { applyCommand, createEmptyPart } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { reconstructImported, RecognizeError, Regenerator } from '@3db/regen';
import { crossesItself, outline, plate, polygonOf, region, rng } from './nurbs-walls.kit';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
const heap = () => (kernel.oc as unknown as { wasmMemory?: { buffer?: { byteLength?: number } } }).wasmMemory?.buffer?.byteLength;

const inside = (p: [number, number], poly: [number, number][]) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

export const FIRST = 1;
export const LAST = 60;

it(`random B-spline wall parts ${FIRST}..${LAST}: each refused or rebuilt the same, nothing crashes`, async () => {
  const h0 = heap();
  expect(h0).toBeGreaterThan(0);
  const [from, to] = [Math.max(FIRST, Number(process.env.FUZZ_FROM ?? FIRST)), Math.min(LAST, Number(process.env.FUZZ_TO ?? LAST))];
  const tally = { rebuilt: 0, refused: 0, skipped: 0, rational: 0, holed: 0, raised: 0, bspline: 0, straight: 0 };
  const refusals: string[] = [];
  for (let seed = from; seed <= to; seed++) {
    const r = rng(1000 + seed);
    const round = (v: number) => Math.round(v * 1000) / 1000;
    const R = round(6 + r() * 14);
    const k = 3 + Math.floor(r() * 4);
    const n = k * (3 + Math.floor(r() * 4));
    const rational = r() < 0.5;
    const straight = r() < 0.3;
    const c: [number, number] = [round((r() - 0.5) * 10), round((r() - 0.5) * 10)];
    const outer = outline(r, c, R, n, k, rational, straight);
    const holed = r() < 0.4;
    const hole = holed ? outline(r, c, round(R * (0.2 + r() * 0.15)), 2 * (4 + Math.floor(r() * 3)), 2, r() < 0.5, false) : undefined;
    const raised = r() < 0.4;
    const bspline = r() < 0.5;
    const depth = round(0.2 + r() * 2.5);
    const t = round(depth + 3 + r() * 10);
    const w = round(2 * (R * 1.4 + Math.abs(c[0])) + 6 + r() * 20);
    const d = round(2 * (R * 1.4 + Math.abs(c[1])) + 6 + r() * 20);
    // only simple outlines, the hole well inside: the generator's own conditions, not the recognizer's
    const po = polygonOf(outer);
    const ph = hole ? polygonOf(hole) : [];
    if (crossesItself(po) || (hole && (crossesItself(ph) || !ph.every((p) => inside(p, po))))) {
      tally.skipped++;
      continue;
    }
    const made: ShapeId[] = [];
    const own = (id: ShapeId) => (made.push(id), id);
    try {
      const s = plate(kernel, w, d, t, region(outer, hole), depth, raised, bspline, own);
      const bytes = new TextEncoder().encode(kernel.exportStep(s, `nurbs-${seed}`));
      const sha = await sha256Hex(bytes);
      const doc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'f.step' }, feature: { id: 'imp1', type: 'importedBody', name: 'i', suppressed: false, blob: 'blob1' } as never, index: 0 });
      const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
      try {
        let out;
        try {
          out = reconstructImported(kernel, regen, doc, 'imp1', solver);
        } catch (e) {
          if (!(e instanceof RecognizeError)) throw new Error(`seed ${seed}: ${(e as Error).message}`);
          tally.refused++;
          refusals.push(`${seed}: ${e.message.slice(0, 160)}`);
          continue;
        }
        const res = regen.rebuild(out.doc);
        expect(res.features.every((f) => f.status === 'ok'), `seed ${seed}`).toBe(true);
        expect(res.features.filter((f) => f.sketch && f.sketch.dof !== 0).map((f) => f.id), `seed ${seed}`).toEqual([]);
        const one = kernel.boolean('cut', s, res.body!.shape);
        const two = kernel.boolean('cut', res.body!.shape, s);
        const apart = (kernel.massProps(one.shape).volume + kernel.massProps(two.shape).volume) / kernel.massProps(s).volume;
        kernel.release(one.shape);
        kernel.release(two.shape);
        expect(apart, `seed ${seed}`).toBeLessThan(1e-6);
        const splines = out.doc.features.flatMap((f) => (f.type === 'sketch' ? f.entities.filter((e) => e.type === 'spline' && e.nurbs) : []));
        expect(splines.length, `seed ${seed}`).toBeGreaterThan(0);
        tally.rebuilt++;
        if (rational) tally.rational++;
        if (holed) tally.holed++;
        if (raised) tally.raised++;
        if (bspline) tally.bspline++;
        if (straight) tally.straight++;
      } finally {
        regen.dispose();
      }
    } finally {
      for (const id of made) kernel.release(id);
    }
  }
  const h1 = heap()!;
  console.log(`B-spline wall fuzz ${from}..${to}: ${JSON.stringify(tally)}; heap ${(h0! / 2 ** 20).toFixed(1)} → ${(h1 / 2 ** 20).toFixed(1)} MiB`);
  if (refusals.length) console.log(refusals.join('\n'));
  // most parts must come back: a refusal is allowed (never a wrong solid), but a recognizer that refuses them all proves nothing
  expect(tally.rebuilt).toBeGreaterThan(0.8 * (to - from + 1 - tally.skipped));
}, 1_800_000);
