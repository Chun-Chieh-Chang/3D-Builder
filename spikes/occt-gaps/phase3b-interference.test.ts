// Phase 3b-0 items 2 and 3: a mirrored part (determinant −1) through STEP, and the time of an interference check of 20 components (190 pairs).
// Run: npx vitest run --config spikes/occt-gaps/vitest.config.ts phase3b
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { PlaneGcsSolver } from '@3db/sketch';
import { build, circle, extrude, front, rectangle, sketch } from '../../tests/phase1/builders';

let kernel: Kernel;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});

/** a 30 × 20 × 10 plate with a hole, off-centre so that a mirror is not its own image. */
function part() {
  const doc = build(sketch('s0', front, rectangle('a', 0, 0, 30, 20), circle('c', 8, 6, 3)), extrude('e0', 's0', 'boss', { type: 'blind', depth: '10' }));
  const r = regen.rebuild(doc);
  return r.body!.shape;
}
const move = (x: number, y: number, z: number) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
const time = (fn: () => void) => { const t = performance.now(); fn(); return performance.now() - t; };

describe('3b-0', () => {
  it('mirror: volume, validity, STEP round trip', () => {
    const p = part();
    const m = kernel.transformed(p, [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    const v = kernel.massProps(p), w = kernel.massProps(m);
    console.log(`mirror: volume ${v.volume} → ${w.volume}, centroid x ${v.center[0]} → ${w.center[0]}, valid ${kernel.isValid(m)}`);
    const step = kernel.exportStep(m, 'Mirrored');
    const back = kernel.importStep(step);
    const bv = kernel.massProps(back.shape);
    console.log(`STEP round trip: volume ${bv.volume}, centroid x ${bv.center[0]}, valid ${kernel.isValid(back.shape)}`);
    expect(Math.abs(w.volume - v.volume) / v.volume).toBeLessThan(1e-9);
    expect(Math.abs(bv.volume - v.volume) / v.volume).toBeLessThan(1e-6);
    expect(Math.abs(bv.center[0] - w.center[0])).toBeLessThan(1e-6);
  });

  it('interference of 20 components (190 pairs)', () => {
    const p = part();
    // 5 × 4 grid, pitch 28 in x (2 mm overlap in x with the neighbour) and 40 in y (no overlap), so 16 pairs touch in bounding boxes and really overlap
    const comps = Array.from({ length: 20 }, (_, i) => kernel.transformed(p, move((i % 5) * 28, Math.floor(i / 5) * 40, 0)));
    const boxes = comps.map((c) => kernel.bounds(c));
    let pairs = 0, hits = 0, tested = 0;
    const withFilter = time(() => {
      for (let i = 0; i < comps.length; i++) for (let j = i + 1; j < comps.length; j++) {
        pairs++;
        const a = boxes[i]!, b = boxes[j]!;
        if ([0, 1, 2].some((k) => a.max[k]! < b.min[k]! || b.max[k]! < a.min[k]!)) continue;
        tested++;
        const r = kernel.boolean('common', comps[i]!, comps[j]!);
        const vol = kernel.massProps(r.shape).volume;
        if (vol > 1e-6) hits++;
        kernel.release(r.shape);
      }
    });
    const noFilter = time(() => {
      for (let i = 0; i < comps.length; i++) for (let j = i + 1; j < comps.length; j++) {
        const r = kernel.boolean('common', comps[i]!, comps[j]!);
        kernel.massProps(r.shape);
        kernel.release(r.shape);
      }
    });
    console.log(`${pairs} pairs: bounding-box filter ${withFilter.toFixed(0)} ms (${tested} boolean tests, ${hits} interferences); every pair ${noFilter.toFixed(0)} ms`);
    expect(hits).toBe(16); // 4 neighbouring pairs per row × 4 rows
  });
});
