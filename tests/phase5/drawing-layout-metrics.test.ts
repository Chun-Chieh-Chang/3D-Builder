/**
 * ADR 0261: what `layoutMetrics` measures of a page — the fill of the area, the clear space between views counted with the dimensions drawn for them, how far a detail
 * is from its parent and whether another view is in the way, whether a detail has anything in it, scales that are not standard. Every number is worked out by hand
 * from the synthetic scene below.
 */
import { describe, expect, it } from 'vitest';
import type { DrawingView } from '@3db/model';
import { layoutMetrics, type PlacedView, type SceneItem } from '@3db/drawing';

const area = { x: 0, y: 0, w: 400, h: 200 };
const view = (id: string, extra: Record<string, unknown> = {}): DrawingView => ({ id, name: id, source: 'x.3dbx', direction: 'front', ...extra }) as DrawingView;
const placed = (id: string, x: number, y: number, w: number, h: number, scale = 1): [string, PlacedView] => [id, { id, at: [x, y], scale, w, h, centre: [0, 0] }];
/** The outline of a view's box, owned by the view as its lines are. */
const outline = (id: string, x: number, y: number, w: number, h: number): SceneItem => ({
  kind: 'polyline',
  owner: `view:${id}`,
  style: 'visible',
  closed: true,
  points: [x - w / 2, y - h / 2, x + w / 2, y - h / 2, x + w / 2, y + h / 2, x - w / 2, y + h / 2],
});
/** A line drawn for a dimension (its `group`), from (x0, y) to (x1, y). */
const dimLine = (group: string, x0: number, x1: number, y: number): SceneItem => ({ kind: 'polyline', group, style: 'dimension', points: [x0, y, x1, y] });

// A: box x 80..120, y 90..110 · B: x 180..220, y 90..110 · C below A: x 80..120, y 30..50
const A = placed('A', 100, 100, 40, 20);
const B = placed('B', 200, 100, 40, 20);
const C = placed('C', 100, 40, 40, 20);

describe('the clear space between views is measured between the boxes of the views and what is drawn for them', () => {
  const items = [outline('A', 100, 100, 40, 20), outline('B', 200, 100, 40, 20), dimLine('d1', 120, 140, 100), dimLine('d2', 170, 180, 100)];
  const m = layoutMetrics({ items, views: [view('A'), view('B')], placed: new Map([A, B]), dimensionView: new Map([['d1', 'A'], ['d2', 'B']]), area });

  it('the boxes are 60 mm apart; A\'s dimension reaches 20 mm into the gap and B\'s 10 mm: 30 mm are left', () => {
    expect(m.views.map((v) => v.reach)).toEqual([
      { left: 0, right: 20, below: 0, above: 0 },
      { left: 10, right: 0, below: 0, above: 0 },
    ]);
    expect(m.clearances).toEqual([{ a: 'A', b: 'B', axis: 'x', gap: 30, gx: 30, gy: -20 }]);
    expect(m.minClearance).toBe(30);
  });

  it('a dimension that reaches past the other\'s makes the gap negative, and the pair is the nearest', () => {
    const crowded = [...items.slice(0, 3), dimLine('d2', 130, 180, 100)];
    const c = layoutMetrics({ items: crowded, views: [view('A'), view('B')], placed: new Map([A, B]), dimensionView: new Map([['d1', 'A'], ['d2', 'B']]), area });
    expect(c.minClearance).toBe(-10);
  });

  it('views one above the other are measured on y; a view in a corner is measured by the distance between the corners', () => {
    const stack = layoutMetrics({ items: [outline('A', 100, 100, 40, 20), outline('C', 100, 40, 40, 20)], views: [view('A'), view('C')], placed: new Map([A, C]), dimensionView: new Map(), area });
    expect(stack.clearances).toEqual([{ a: 'A', b: 'C', axis: 'y', gap: 40, gx: -40, gy: 40 }]);
    const D = placed('D', 300, 40, 40, 20); // x 280..320, y 30..50: from A (x ≤ 120, y ≥ 90) 160 across and 40 down
    const diagonal = layoutMetrics({ items: [outline('A', 100, 100, 40, 20), outline('D', 300, 40, 40, 20)], views: [view('A'), view('D')], placed: new Map([A, D]), dimensionView: new Map(), area });
    expect(diagonal.clearances[0]!.gap).toBeCloseTo(Math.hypot(160, 40), 3);
  });

  it('boxes that overlap are reported as such', () => {
    const E = placed('E', 110, 100, 40, 20); // x 90..130 over A
    const o = layoutMetrics({ items: [outline('A', 100, 100, 40, 20), outline('E', 110, 100, 40, 20)], views: [view('A'), view('E')], placed: new Map([A, E]), dimensionView: new Map(), area });
    // 30 across in x and 20 in y: the least that has to move to part them is 20
    expect(o.clearances[0]).toMatchObject({ axis: 'both', gap: -20, gx: -30, gy: -20 });
  });
});

describe('what the page fills', () => {
  it('the width and the height of what is drawn against the area, and the share of the area the views take', () => {
    const items = [outline('A', 100, 100, 40, 20), outline('B', 200, 100, 40, 20), dimLine('d1', 120, 140, 70), dimLine('d2', 170, 180, 130)];
    const m = layoutMetrics({ items, views: [view('A'), view('B')], placed: new Map([A, B]), dimensionView: new Map([['d1', 'A'], ['d2', 'B']]), area });
    // x from 80 to 220: 140 of 400; y from 70 (d1) to 130 (d2): 60 of 200; two boxes of 40 × 20 in 400 × 200
    expect(m.fillW).toBeCloseTo(0.35, 6);
    expect(m.fillH).toBeCloseTo(0.3, 6);
    expect(m.viewAreaFill).toBeCloseTo(0.02, 6);
  });

  it('an empty page fills nothing', () => {
    const m = layoutMetrics({ items: [], views: [], placed: new Map(), dimensionView: new Map(), area });
    expect([m.used, m.fillW, m.fillH, m.viewAreaFill, m.minClearance]).toEqual([null, 0, 0, 0, null]);
  });
});

describe('a detail', () => {
  // a detail of A, 20 mm across, with 31.416 mm (half its circle) of lines in it
  const half = (Math.PI * 20) / 2;
  /** `half` mm of line inside the detail's 20 mm box at (x, y): a stroke across it and a part of the way back. */
  const ink = (id: string, x: number, y: number): SceneItem => ({ kind: 'polyline', owner: `view:${id}`, style: 'visible', points: [x - 10, y, x + 10, y, x + 10 - (half - 20), y] });

  it('far to the right of A with B between them: 180 mm from it, in the way', () => {
    const D = placed('D', 300, 100, 20, 20); // x 290..310
    const m = layoutMetrics({
      items: [outline('A', 100, 100, 40, 20), outline('B', 200, 100, 40, 20), ink('D', 300, 100)],
      views: [view('A'), view('B'), view('D', { kind: 'detail', parent: 'A' })],
      placed: new Map([A, B, D]),
      dimensionView: new Map(),
      area,
    });
    expect(m.details).toHaveLength(1);
    // the parent's diagonal is 44.721; the detail is 20 across, so twice that is 40: the diagonal is the larger
    expect(m.details[0]).toMatchObject({ id: 'D', parent: 'A', distance: 170, blocked: true, parentDiagonal: Math.round(Math.hypot(40, 20) * 1000) / 1000, diameter: 20, maxDistance: Math.round(Math.hypot(40, 20) * 1000) / 1000 });
    expect(m.details[0]!.inkRatio).toBeCloseTo(0.5, 3);
  });

  it('above A with nothing between: 40 mm from it, not blocked', () => {
    const D = placed('D', 100, 160, 20, 20); // y 150..170 over A's top at 110
    const m = layoutMetrics({
      items: [outline('A', 100, 100, 40, 20), outline('B', 200, 100, 40, 20), ink('D', 100, 160)],
      views: [view('A'), view('B'), view('D', { kind: 'detail', parent: 'A' })],
      placed: new Map([A, B, D]),
      dimensionView: new Map(),
      area,
    });
    expect(m.details[0]).toMatchObject({ distance: 40, blocked: false });
  });

  it("how far still counts as beside: the larger of the parent diagonal and twice the detail diameter", () => {
    // a small parent (10 × 10, diagonal 14.142) and a large detail (50 across): twice the detail, 100, is the larger
    const small = placed('S', 100, 100, 10, 10);
    const big = placed('B2', 100, 170, 50, 50);
    const m = layoutMetrics({ items: [outline('S', 100, 100, 10, 10)], views: [view('S'), view('B2', { kind: 'detail', parent: 'S' })], placed: new Map([small, big]), dimensionView: new Map(), area });
    expect(m.details[0]).toMatchObject({ diameter: 50, maxDistance: 100 });
    expect(m.details[0]!.parentDiagonal).toBeCloseTo(14.142, 3);
  });

  it('a detail over its parent is 0 mm from it, never a negative distance', () => {
    const D = placed('D', 110, 100, 20, 20); // x 100..120 inside A's x 80..120
    const m = layoutMetrics({ items: [outline('A', 100, 100, 40, 20), ink('D', 110, 100)], views: [view('A'), view('D', { kind: 'detail', parent: 'A' })], placed: new Map([A, D]), dimensionView: new Map(), area });
    expect(m.details[0]!.distance).toBe(0);
  });

  it('a detail with nothing in it has a ratio of 0', () => {
    const D = placed('D', 100, 160, 20, 20);
    const m = layoutMetrics({ items: [outline('A', 100, 100, 40, 20)], views: [view('A'), view('D', { kind: 'detail', parent: 'A' })], placed: new Map([A, D]), dimensionView: new Map(), area });
    expect(m.details[0]!.inkRatio).toBe(0);
  });
});

describe('scales', () => {
  it('a view drawn at 3:1 (not in ISO 5455) is listed, 5:1 and 1:2 are not', () => {
    const m = layoutMetrics({
      items: [],
      views: [view('A'), view('B'), view('C')],
      placed: new Map([placed('A', 100, 100, 40, 20, 3), placed('B', 200, 100, 40, 20, 5), placed('C', 100, 40, 40, 20, 0.5)]),
      dimensionView: new Map(),
      area,
    });
    expect(m.nonStandardScales).toEqual([{ id: 'A', scale: 3 }]);
  });
});
