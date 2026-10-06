import { describe, expect, it } from 'vitest';
import type { Id } from '@3db/model';
import { alignments } from '../src/interact';
import type { SolvedGeometry } from '../src/types';

/** A 20×10 rectangle's corners p1..p4, a circle's center kc at (10, 5) and the circle itself (r = 3). */
function geometry(): Map<Id, SolvedGeometry> {
  const pts: Record<string, [number, number]> = { p1: [0, 0], p2: [20, 0], p3: [20, 10], p4: [0, 10], kc: [10, 5] };
  const g = new Map<Id, SolvedGeometry>(Object.entries(pts).map(([id, p]) => [id, { type: 'point', p }]));
  g.set('k1', { type: 'circle', c: [10, 5], r: 3, center: 'kc', construction: false });
  return g;
}

describe('horizontal and vertical points (D5.3a)', () => {
  const g = geometry();

  it('lines up horizontally with a corner, an end point first met', () => {
    const r = alignments(g, [35, 10.1], 0.5)!;
    expect(r.align.h?.id).toBe('p3'); // p3 and p4 are equally close; the first in the sketch wins
    expect(r.align.v).toBeUndefined();
    expect(r.p).toEqual([35, 10]); // snapped onto the target's y, x left alone
  });

  it('lines up vertically with a corner', () => {
    const r = alignments(g, [20.2, 30], 0.5)!;
    expect(r.align.v).toMatchObject({ id: 'p2', p: [20, 0] });
    expect(r.align.h).toBeUndefined();
    expect(r.p).toEqual([20, 30]);
  });

  it('lines up with the center of a circle', () => {
    const r = alignments(g, [40, 5.2], 0.5)!;
    expect(r.align.h).toMatchObject({ id: 'kc', p: [10, 5] });
    expect(r.p).toEqual([40, 5]);
  });

  it('lines up with the origin when nothing else is there', () => {
    const r = alignments(g, [-30, 0.2], 0.5, new Set(['p1', 'p2']))!;
    expect(r.align.h).toMatchObject({ id: '@origin', p: [0, 0] });
    expect(r.p).toEqual([-30, 0]);
    const v = alignments(g, [0.2, 40], 0.5, new Set(['p1', 'p4']))!;
    expect(v.align.v?.id).toBe('@origin');
  });

  it('takes the crossing when it is in line with two points, and says so for both', () => {
    const r = alignments(g, [20.1, 5.1], 0.5)!;
    expect(r.align.v?.id).toBe('p2');
    expect(r.align.h?.id).toBe('kc');
    expect(r.p).toEqual([20, 5]);
  });

  it('finds nothing away from every point', () => {
    expect(alignments(g, [7, 3], 0.5)).toBeNull();
  });

  it('leaves out the points it is told to (the one being drawn from)', () => {
    expect(alignments(g, [40, 5.2], 0.5, new Set(['kc']))).toBeNull();
  });

  it('measures in screen pixels: the same pixels reach less of the sketch when zoomed in', () => {
    const near = (px: number) => alignments(g, [40, 5.2], 5 * px);
    expect(near(0.05)).not.toBeNull(); // 5 px = 0.25 mm: 0.2 mm off is in
    expect(near(0.02)).toBeNull(); // 5 px = 0.1 mm: 0.2 mm off is out
    expect(near(0.5)).not.toBeNull();
  });

  it('can be limited to one direction (a line already fixed horizontal keeps its y)', () => {
    const r = alignments(g, [20.1, 5.1], 0.5, new Set(), { h: false, v: true })!;
    expect(r.align.h).toBeUndefined();
    expect(r.p).toEqual([20, 5.1]);
    expect(alignments(g, [20.1, 5.1], 0.5, new Set(), { h: false, v: false })).toBeNull();
  });

  it('takes the nearest point on each axis', () => {
    const two = new Map<Id, SolvedGeometry>([
      ['a', { type: 'point', p: [10, 0] }],
      ['b', { type: 'point', p: [10.2, 7] }],
    ]);
    expect(alignments(two, [10.15, 30], 0.5)!.align.v?.id).toBe('b');
  });

  it('does not line up with curves, only with points', () => {
    expect(alignments(g, [13, 40], 0.5)).toBeNull(); // the circle's rightmost point is at x = 13
  });

  it('is exact: the point returned is on the target coordinates, not near them', () => {
    const r = alignments(g, [20.0004, 4.9996], 0.5)!;
    expect(r.p[0]).toBe(20);
    expect(r.p[1]).toBe(5);
  });
});
