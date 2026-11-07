/** Two sections compared without the kernel (ADR 0243): against shapes whose areas and distances are known by formula. */
import { describe, expect, it } from 'vitest';
import type { SectionEdge } from '@3db/kernel';
import { boundaryLines, compareSections, sectionsClose } from '../../packages/regen/src/recognize/compareSections';

type P = [number, number];
const poly = (...p: P[]): SectionEdge[] => p.map((a, i) => ({ kind: 'line', a, b: p[(i + 1) % p.length]! }));
const square = (x: number, y: number, s: number) => poly([x, y], [x + s, y], [x + s, y + s], [x, y + s]);
const circle = (r: number, c: P = [0, 0]): SectionEdge[] => [{ kind: 'circle', c, r }];
/** A circle in four arcs. */
const arcs = (r: number): SectionEdge[] => {
  const at = (deg: number): P => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];
  return [0, 90, 180, 270].map((d) => ({ kind: 'arc', c: [0, 0], r, a: at(d), b: at(d + 90), mid: at(d + 45) }));
};

describe('compareSections', () => {
  it('a square against the same square shifted: the area not shared and the distance are known', () => {
    const c = compareSections(square(0, 0, 10), square(0.1, 0, 10))!;
    expect(c.areaA).toBeCloseTo(100, 6);
    expect(c.areaB).toBeCloseTo(100, 6);
    expect(c.notShared).toBeCloseTo(2 * 0.1 * 10, 6);
    expect(c.perimeter).toBeCloseTo(40, 9);
    expect(c.distance).toBeCloseTo(0.1, 9);
  });

  it('a square against itself: nothing not shared, no distance', () => {
    const c = compareSections(square(0, 0, 10), square(0, 0, 10))!;
    expect(c.notShared).toBe(0);
    expect(c.distance).toBe(0);
  });

  it('two circles: the ring between them, and the gap', () => {
    const [r, d] = [20, 0.01];
    const c = compareSections(circle(r), circle(r + d))!;
    expect(c.areaA).toBeCloseTo(Math.PI * r * r, 2);
    expect(c.notShared).toBeCloseTo(Math.PI * ((r + d) ** 2 - r ** 2), 2);
    expect(c.distance).toBeCloseTo(d, 4);
    expect(c.perimeter).toBeCloseTo(2 * Math.PI * r, 3);
  });

  it('arcs are read in their own direction: a circle of four arcs is the circle, whichever way each runs', () => {
    const forward = compareSections(arcs(15), circle(15))!;
    expect(forward.notShared).toBeLessThan(1e-2);
    expect(forward.distance).toBeLessThan(1e-4);
    const reversed = arcs(15).map((e): SectionEdge => (e.kind === 'arc' ? { ...e, a: e.b, b: e.a } : e));
    expect(compareSections(reversed, circle(15))!.distance).toBeLessThan(1e-4);
  });

  it('an arc takes the side its middle is on, the short way or the long way', () => {
    const long: SectionEdge[] = [{ kind: 'arc', c: [0, 0], r: 10, a: [10, 0], b: [0, 10], mid: [-10, 0] }, { kind: 'line', a: [0, 10], b: [10, 0] }];
    const lines = boundaryLines(long)!;
    expect(lines.some((l) => l[0][0] < -9.9)).toBe(true);
    // three quarters of the circle and the triangle to its chord
    const c = compareSections(long, long)!;
    expect(c.areaA).toBeCloseTo((0.75 * Math.PI * 100) + 50, 1);
  });

  it('a hole is outside, and the order of the pieces does not matter', () => {
    const whole = [...square(0, 0, 10), ...square(4, 4, 2)];
    const c = compareSections(whole, [...square(4, 4, 2).reverse(), ...square(0, 0, 10).reverse()])!;
    expect(c.areaA).toBeCloseTo(100 - 4, 6);
    expect(c.notShared).toBeCloseTo(0, 9);
    expect(compareSections(whole, square(0, 0, 10))!.notShared).toBeCloseTo(4, 6);
  });

  it('a rational Bézier is read through its weights: the quarter circle is the arc', () => {
    const w = Math.SQRT1_2;
    const r = 10;
    const bezier: SectionEdge = { kind: 'bezier', curve: 'bsplinecurve', spans: [[[r, 0, 0, 1], [r * w, r * w, 0, w], [0, r, 0, 1]]] };
    const close: SectionEdge[] = [{ kind: 'line', a: [0, r], b: [0, 0] }, { kind: 'line', a: [0, 0], b: [r, 0] }];
    const arc: SectionEdge = { kind: 'arc', c: [0, 0], r, a: [r, 0], b: [0, r], mid: [r * w, r * w] };
    const c = compareSections([bezier, ...close], [arc, ...close])!;
    expect(c.areaA).toBeCloseTo((Math.PI * r * r) / 4, 2);
    expect(c.distance).toBeLessThan(1e-4);
  });

  it('a boundary far from the other is measured as far, not left out because no cell is near', () => {
    expect(compareSections(square(0, 0, 1), square(50, 50, 1))!.distance).toBeGreaterThan(60);
  });

  it('the distance is the larger of the two ways: a piece only one of them has counts, whichever it is', () => {
    const plain = square(0, 0, 10);
    const island = [...plain, ...square(4, 4, 2)];
    expect(compareSections(island, plain)!.distance).toBeCloseTo(4, 6);
    expect(compareSections(plain, island)!.distance).toBeCloseTo(4, 6);
  });

  it('a curve it cannot read is no comparison', () => {
    expect(compareSections([{ kind: 'other', curve: 'ellipse' }], square(0, 0, 1))).toBeNull();
    expect(compareSections(square(0, 0, 1), [{ kind: 'other', curve: 'ellipse' }])).toBeNull();
  });

  it('nothing against nothing', () => {
    expect(compareSections([], [])).toEqual({ areaA: 0, areaB: 0, notShared: 0, perimeter: 0, distance: 0 });
  });
});

describe('sectionsClose', () => {
  const eps = 0.005;
  const limit = 0.008;
  const centred = (s: number) => square(-s / 2, -s / 2, s);

  it('a boundary within the distance, sharing its area: close', () => {
    const c = compareSections(square(0, 0, 10), square(0.005, 0, 10))!;
    expect(sectionsClose(c, limit)).toBe(true);
  });

  it('too far: not close, though the areas are the same', () => {
    const c = compareSections(square(0, 0, 10), square(0.1, 0, 10))!;
    expect(Math.abs(c.areaA - c.areaB)).toBeLessThan(1e-6);
    expect(sectionsClose(c, limit)).toBe(false);
  });

  it('near everywhere and the same area, but sharing almost nothing: not close', () => {
    // bands that change places: squares of 10, s1, 6 and 2 bound A; B has them too, and a square just inside the outermost and the innermost, which turns inside and outside over
    const s1 = Math.sqrt(84);
    const a = [...centred(10), ...centred(s1), ...centred(6), ...centred(2)];
    const b = [...a, ...centred(10 - 2 * eps), ...centred(2 - 2 * eps)];
    const c = compareSections(a, b)!;
    // what makes this the case it is meant to be: the boundaries are near and the areas nearly equal, within what the distance allows
    expect(c.distance).toBeCloseTo(eps, 6);
    expect(Math.abs(c.areaA - c.areaB)).toBeLessThan(limit * c.perimeter);
    expect(c.notShared).toBeGreaterThan(0.9 * (c.areaA + c.areaB));
    expect(sectionsClose(c, limit)).toBe(false);
  });
});
