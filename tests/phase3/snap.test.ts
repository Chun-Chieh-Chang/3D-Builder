/**
 * Places that can be pointed at while measuring (a point anywhere): the pieces of an edge's line segments, its middle along its length, and the centre of a circle or an arc
 * found from the polyline. Worked out by hand.
 */
import { describe, expect, it } from 'vitest';
import { circleCentre, middleOf, polylinesOf, type V3 } from '@3db/render';

/** The segments (two points each, flat) of a polyline through the points. */
const segments = (points: V3[]): number[] => points.slice(1).flatMap((p, i) => [...points[i]!, ...p]);
const ring = (centre: V3, r: number, from: number, to: number, n: number, plane: 'xy' | 'xz' = 'xy'): V3[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / n;
    return plane === 'xy' ? [centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a), centre[2]] : [centre[0] + r * Math.cos(a), centre[1], centre[2] + r * Math.sin(a)];
  });

describe('the points of each edge', () => {
  it('segments that follow each other are one line; the edges are told apart by the owner; a break starts a new piece', () => {
    const a: V3[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0]];
    const b: V3[] = [[0, 5, 0], [0, 6, 0]];
    const positions = [...segments(a), ...segments(b)];
    const lines = polylinesOf(positions, [7, 7, 9]);
    expect(lines.get(7)).toEqual(a);
    expect(lines.get(9)).toEqual(b);
    // the second segment does not start where the first ended: two pieces of one edge
    const broken = polylinesOf([0, 0, 0, 1, 0, 0, 5, 5, 5, 6, 5, 5], [3, 3]);
    expect(broken.get(3)).toEqual([[0, 0, 0], [1, 0, 0], [5, 5, 5], [6, 5, 5]]);
  });
});

describe('the middle of an edge, along its length', () => {
  it('a straight line: half way; a bent one (3 along x, then 1 along y): at 2 along x, since 4 / 2 = 2', () => {
    expect(middleOf([[0, 0, 0], [10, 0, 0]])).toEqual([5, 0, 0]);
    expect(middleOf([[0, 0, 0], [3, 0, 0], [3, 1, 0]])).toEqual([2, 0, 0]);
    expect(middleOf([[0, 0, 0], [1, 0, 0], [1, 3, 0]])).toEqual([1, 1, 0]); // 4 / 2 = 2: 1 along x, 1 along y
  });
});

describe('the centre of a circle or an arc', () => {
  it('a whole circle (its line ends where it began), in the xy plane and in a tilted one', () => {
    const c = circleCentre(ring([1, 2, 3], 5, 0, 2 * Math.PI, 64));
    expect(c?.radius).toBeCloseTo(5, 9);
    expect(c?.centre.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([1, 2, 3]);
    const t = circleCentre(ring([-4, 7, 1], 2.5, 0, 2 * Math.PI, 48, 'xz'));
    expect(t?.radius).toBeCloseTo(2.5, 9);
    expect(t?.centre.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([-4, 7, 1]);
  });

  it('an arc: a quarter of a circle, the centre is a long way from every point of it', () => {
    const c = circleCentre(ring([10, 10, 0], 10, Math.PI, 1.5 * Math.PI, 24));
    expect(c?.radius).toBeCloseTo(10, 9);
    expect(c?.centre.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([10, 10, 0]);
  });

  it('what is no circle has none: a straight line, an ellipse, a polyline of which one point is off the circle through the others, too few points', () => {
    expect(circleCentre([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]])).toBeNull();
    const ellipse: V3[] = Array.from({ length: 49 }, (_, i) => [8 * Math.cos((i * 2 * Math.PI) / 48), 4 * Math.sin((i * 2 * Math.PI) / 48), 0]);
    expect(circleCentre(ellipse)).toBeNull();
    expect(circleCentre([[0, 0, 0], [4, 0, 0], [4, 4, 0], [2, 5, 0], [0, 4, 0], [0, 0, 0]])).toBeNull(); // (2, 5) is not as far from (2, 2) as the corners
    expect(circleCentre([[0, 0, 0], [1, 1, 0], [2, 0, 0]])).toBeNull();
  });
});
