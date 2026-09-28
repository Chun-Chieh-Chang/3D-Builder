import { describe, expect, it } from 'vitest';
import type { Id } from '@3db/model';
import {
  applicableRelations,
  circleThrough,
  hitTest,
  inferDirection,
  layoutDimension,
  smartDimension,
  snap,
  tangentArcCenter,
} from '../src/interact';
import type { SolvedGeometry } from '../src/types';

/** Solved geometry of a 20×10 rectangle p1..p4 / l1..l4 plus a circle k1 (r = 3) at (10, 5). */
function geometry(): Map<Id, SolvedGeometry> {
  const pts: Record<string, [number, number]> = { p1: [0, 0], p2: [20, 0], p3: [20, 10], p4: [0, 10], kc: [10, 5] };
  const g = new Map<Id, SolvedGeometry>(Object.entries(pts).map(([id, p]) => [id, { type: 'point', p }]));
  const line = (id: string, p1: string, p2: string) => g.set(id, { type: 'line', a: pts[p1]!, b: pts[p2]!, p1, p2, construction: false });
  line('l1', 'p1', 'p2');
  line('l2', 'p2', 'p3');
  line('l3', 'p3', 'p4');
  line('l4', 'p4', 'p1');
  g.set('k1', { type: 'circle', c: [10, 5], r: 3, center: 'kc', construction: false });
  return g;
}

describe('hit testing and snapping', () => {
  const g = geometry();
  it('prefers points over the curves they lie on', () => {
    expect(hitTest(g, [19.8, 0.1], 0.5)).toMatchObject({ id: 'p2', kind: 'point' });
    expect(hitTest(g, [15, 0.2], 0.5)).toMatchObject({ id: 'l1', kind: 'line' });
    expect(hitTest(g, [13.1, 5], 0.5)).toMatchObject({ id: 'k1', kind: 'circle' });
    expect(hitTest(g, [0.1, -0.1], 0.5)).toMatchObject({ kind: 'point' }); // p1 sits on the origin
  });

  it('snaps to points, then midpoints, then curves', () => {
    expect(snap(g, [20.2, 9.9], 0.5)).toMatchObject({ kind: 'point', id: 'p3' });
    expect(snap(g, [10.2, 0.3], 0.5)).toMatchObject({ kind: 'midpoint', line: 'l1', p: [10, 0] });
    expect(snap(g, [6, 0.3], 0.5)).toMatchObject({ kind: 'curve', id: 'l1', p: [6, 0] });
    expect(snap(g, [6, 3], 0.5)).toMatchObject({ kind: 'free' });
    expect(snap(g, [0.2, 0.2], 0.5, new Set(['p1']))).toMatchObject({ kind: 'point', id: '@origin' });
  });

  it('infers horizontal and vertical lines within a few degrees', () => {
    expect(inferDirection([0, 0], [10, 0.3])).toEqual({ b: [10, 0], direction: 'horizontal' });
    expect(inferDirection([0, 0], [-0.2, 8])).toEqual({ b: [0, 8], direction: 'vertical' });
    expect(inferDirection([0, 0], [5, 5]).direction).toBeNull();
  });
});

describe('arcs from picks', () => {
  it('finds the circle through three points and the tangent-arc center', () => {
    const c = circleThrough([1, 0], [0, 1], [-1, 0])!;
    expect(c.c[0]).toBeCloseTo(0, 12);
    expect(c.r).toBeCloseTo(1, 12);
    expect(circleThrough([0, 0], [1, 1], [2, 2])).toBeNull();
    const center = tangentArcCenter([10, 0], [1, 0], [14, 4])!; // leaving +x, turning left
    expect(center[0]).toBeCloseTo(10, 12);
    expect(center[1]).toBeCloseTo(4, 12);
  });
});

describe('smart dimension (C1.28)', () => {
  const g = geometry();
  it('dimensions a line, a circle, two lines and two points like SolidWorks', () => {
    expect(smartDimension(g, ['l1'], [10, -3])).toMatchObject({ body: { type: 'distance', a: 'l1' }, value: 20 });
    expect(smartDimension(g, ['k1'], [15, 8])).toMatchObject({ body: { type: 'diameter', circle: 'k1' }, value: 6 });
    expect(smartDimension(g, ['l1', 'l3'], [25, 5])).toMatchObject({ body: { type: 'distance', a: 'l1', b: 'l3' }, value: 10 });
    expect(smartDimension(g, ['l1', 'l2'], [25, 5])).toMatchObject({ body: { type: 'angle', a: 'l1', b: 'l2' }, value: 90 });
    expect(smartDimension(g, ['p1', 'kc'], [5, -4])).toMatchObject({ body: { type: 'distanceX' }, value: 10 });
    expect(smartDimension(g, ['p1', 'kc'], [-4, 2])).toMatchObject({ body: { type: 'distanceY' }, value: 5 });
    expect(smartDimension(g, ['p1', 'kc'], [12, 9])!.body.type).toBe('distance');
  });

  it('measures the angle on the side it is placed, like SolidWorks', () => {
    // Two lines from the origin 60° apart, and a V drawn head to tail (D → E → F) with a 90° opening.
    const pts: Record<string, [number, number]> = { o: [0, 0], x: [10, 0], y: [5, 5 * Math.sqrt(3)], D: [15, 40], E: [0, 25], F: [-15, 40] };
    const g = new Map<Id, SolvedGeometry>(Object.entries(pts).map(([id, p]) => [id, { type: 'point', p }]));
    const line = (id: string, p1: string, p2: string) => g.set(id, { type: 'line', a: pts[p1]!, b: pts[p2]!, p1, p2, construction: false });
    line('ox', 'o', 'x');
    line('oy', 'o', 'y');
    line('DE', 'D', 'E');
    line('EF', 'E', 'F');
    const at = (place: [number, number], ids: Id[] = ['ox', 'oy']) => {
      const r = smartDimension(g, ids, place)!;
      return { ...r.body, value: Math.round(r.value * 1e9) / 1e9 };
    };
    expect(at([6, 2])).toEqual({ type: 'angle', a: 'ox', b: 'oy', value: 60 }); // inside
    expect(at([-3, 3])).toEqual({ type: 'angle', a: 'oy', b: 'ox', flip: 'b', value: 120 }); // beside it
    expect(at([-6, -2])).toEqual({ type: 'angle', a: 'ox', b: 'oy', flip: 'both', value: 60 }); // opposite
    expect(at([0, 35], ['DE', 'EF'])).toEqual({ type: 'angle', a: 'DE', b: 'EF', flip: 'a', value: 90 }); // inside the V
    // below the bottom of the V: DE continued past E (225°), then EF reversed (315°), 90° counter-clockwise
    expect(at([0, 15], ['DE', 'EF'])).toEqual({ type: 'angle', a: 'DE', b: 'EF', flip: 'b', value: 90 });
  });

  it('orients angle dimensions so the stored angle is positive', () => {
    const r = smartDimension(g, ['l2', 'l1'], [25, 5])!;
    expect(r.body).toMatchObject({ type: 'angle', a: 'l1', b: 'l2' });
    expect(r.value).toBeCloseTo(90, 9);
  });

  it('lays a length dimension outside the geometry', () => {
    const layout = layoutDimension({ id: 'd', type: 'distance', a: 'l1', value: '20' }, g, 0.05, [10, 5])!;
    expect(layout.text[1]).toBeLessThan(0); // below the bottom edge, away from the center
  });
});

describe('applicable relations (C1.26)', () => {
  const g = geometry();
  const types = (sel: Id[]) => applicableRelations(g, sel).map((r) => r.type);
  it('offers what SolidWorks offers for each selection', () => {
    expect(types(['l1'])).toEqual(['horizontal', 'vertical']);
    expect(types(['l1', 'l3'])).toEqual(['collinear', 'parallel', 'perpendicular', 'equal']);
    expect(types(['p1', 'p3'])).toEqual(['coincident', 'horizontal', 'vertical']);
    expect(types(['kc', 'l1'])).toEqual(['pointOnCurve', 'midpoint']);
    expect(types(['l1', 'k1'])).toEqual(['tangent']);
    expect(types(['p2', 'p4', 'l1'])).toEqual(['symmetric']);
    expect(types(['p1'])).toEqual(['fix']);
  });
});
