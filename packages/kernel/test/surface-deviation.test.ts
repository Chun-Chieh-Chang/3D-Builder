/**
 * `Kernel.surfaceDeviation` (ADR 0248): ∫ over A's boundary of the distance to B's, the comparison after a recognized rebuild. Every answer here is known
 * without the code under test: the same solid (0); a box moved by δ (V(A △ B) = 2·b·c·δ exactly, both ways); a cylinder grown by δ (the wall at δ over
 * 2πrh, the ends at 0); half the top lowered by δ (the upper plane's surface, untrimmed, runs over the lowered half: only the classifier keeps the
 * distance there δ and not 0); a hole one solid has and the other has not (seen only one way, which is why the comparison asks both); and an exact
 * round against OCCT's of the same edge (the pair a boolean could not measure), finished and small.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type ShapeId } from '../src';
import { __body, sample } from './exact-round-fuzz.kit';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
const box = (x0: number, y0: number, z0: number, x: number, y: number, z: number): ShapeId =>
  kernel.extrude({ ...XY, origin: [0, 0, z0] } as never, [{ outer: [[x0, y0], [x0 + x, y0], [x0 + x, y0 + y], [x0, y0 + y]].map((a, i, p) => L(a, p[(i + 1) % 4]!, 'q' + i)), holes: [] }] as never, [0, 0, z]).shape;
const cyl = (cx: number, cy: number, z0: number, r: number, h: number): ShapeId =>
  kernel.extrude({ ...XY, origin: [0, 0, z0] } as never, [{ outer: [{ kind: 'circle', c: [cx, cy], r, source: 'c' }], holes: [] }] as never, [0, 0, h]).shape;
const both = (a: ShapeId, b: ShapeId) => [kernel.surfaceDeviation(a, b), kernel.surfaceDeviation(b, a)] as const;

describe('surfaceDeviation against known answers', () => {
  it('the same solid, through a STEP file: 0 to 1e-12 of the volume, its weights the area', () => {
    const a = box(0, 0, 0, 40, 30, 12);
    const b = kernel.importStep(new TextEncoder().encode(kernel.exportStep(a, 'p'))).shape;
    for (const d of both(a, b)) {
      expect(d.integral / 14400).toBeLessThan(1e-12);
      expect(d.max).toBeLessThan(1e-12);
      expect(Math.abs(d.area - 4080) / 4080).toBeLessThan(1e-12);
    }
  });

  // Two errors, asserted apart (AGENTS §4 2026-10-19 #3): the measure's, 1e-9 of the answer; and the arithmetic's, a distance taken between points
  // some 40 mm from the origin carries about 1e-14 mm, which over the area is 1e-13 mm³ per mm² (1e-7 of the answer at δ = 1e-7, measured 6.6e-9).
  const near = (got: number, want: number, area: number) => expect(Math.abs(got - want)).toBeLessThan(1e-9 * want + 1e-13 * area);

  it('a box moved by δ: 2·b·c·δ both ways', () => {
    const a = box(0, 0, 0, 40, 30, 12);
    for (const delta of [1e-3, 1e-5, 1e-7]) {
      for (const d of both(a, box(delta, 0, 0, 40, 30, 12))) {
        near(d.integral, 2 * 30 * 12 * delta, d.area);
        near(d.max, delta, 1);
      }
    }
  });

  it('a cylinder grown by δ: from the smaller, its wall 2πrh at δ; from the larger, its wall 2π(r+δ)h at δ', () => {
    const a = cyl(0, 0, 0, 5, 20);
    for (const delta of [1e-3, 1e-5]) {
      const [ab, ba] = both(a, cyl(0, 0, 0, 5 + delta, 20));
      near(ab.integral, 2 * Math.PI * 5 * 20 * delta, ab.area);
      near(ba.integral, 2 * Math.PI * (5 + delta) * 20 * delta, ba.area);
    }
  });

  it('half the top lowered by δ: δ over that half (the upper plane runs over it untrimmed; the classifier keeps it out)', () => {
    const a = box(0, 0, 0, 40, 30, 12);
    for (const delta of [1e-3, 1e-5]) {
      const b = kernel.boolean('cut', a, box(20, -1, 12 - delta, 21, 32, 2)).shape;
      const [ab, ba] = both(a, b);
      for (const d of [ab, ba]) expect(Math.abs(d.integral / (20 * 30 * delta) - 1)).toBeLessThan(1e-3);
      // with a mesh as coarse as 5 mm every face within 10 mm of a point is asked, so the upper plane is asked over most of the lowered half: there only
      // the classifier stands between δ and 0 (with the default mesh the upper plane is asked only within 0.05 mm of the step, where no point falls)
      for (const d of [kernel.surfaceDeviation(a, b, 5), kernel.surfaceDeviation(b, a, 5)]) expect(Math.abs(d.integral / (20 * 30 * delta) - 1)).toBeLessThan(1e-3);
    }
  });

  it('a hole one has and the other has not: seen from the one with the hole, at least its volume; from the other, not at all', () => {
    const a = box(0, 0, 0, 40, 30, 12);
    const holed = kernel.boolean('cut', a, cyl(20, 15, -1, 0.25, 14)).shape;
    const [fromHole, fromPlain] = both(holed, a);
    expect(fromHole.integral).toBeGreaterThan(Math.PI * 0.25 ** 2 * 12);
    // the hole's 0.2 mm² of top is between the plain top's points: one way alone would call the two the same
    expect(fromPlain.integral).toBeLessThan(1e-9);
  });

  it('an exact round against OCCT\'s round of the same edges (the pair a boolean could trap on): finished, and at least the difference of their volumes', () => {
    const input = sample(41);
    const { shape, edges } = __body(kernel, input);
    const exact = kernel.fillet(shape, edges, input.r, undefined, undefined, true).shape;
    expect(kernel.exactRoundLog.map((x) => x.outcome)).toEqual(['exact', 'exact']);
    const occt = kernel.fillet(shape, edges, input.r, undefined, undefined, false).shape;
    const [v1, v2] = [kernel.massProps(exact).volume, kernel.massProps(occt).volume];
    // the volume between two solids is at least the difference of their volumes (measured 1.4e-7 of the volume between, OCCT's round off the ball)
    for (const d of both(exact, occt)) {
      expect(d.integral).toBeGreaterThanOrEqual(Math.abs(v1 - v2) * (1 - 1e-6));
      expect(d.integral / v1).toBeLessThan(1e-4);
    }
  });
});
