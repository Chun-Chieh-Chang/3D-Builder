/**
 * 「最適比例」: the scale and the shift that put the views with what is drawn on them (dimensions, marks) into the area of the sheet, not only the views' boxes.
 * The numbers are worked out by hand: A3 landscape, the area is 374 x 213 at (28, 66); front 100 x 60, top 100 x 40, right 40 x 60, gap 25.
 */
import { describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, type Dimension, type DrawingDoc, type DrawingView, type Ref } from '@3db/model';
import { centreViews, fitViews, itemsBounds, suggestScale, type ElementsResult, type ViewLines } from '@3db/drawing';

const view = (id: string, direction: 'front' | 'top' | 'right', extra: Partial<DrawingView> = {}): DrawingView => ({ id, name: id, source: 'x.3dbx', direction, ...extra }) as DrawingView;
const box = (w: number, h: number): ViewLines => ({ visible: [[0, 0, w, h]], hidden: [], box: { min: [0, 0], max: [w, h] } });
const lines = new Map<string, ViewLines>([['f', box(100, 60)], ['t', box(100, 40)], ['r', box(40, 60)]]);
const ref = (name: string): Ref => ({ kind: 'vertex', name });
const point = (x: number, y: number) => ({ kind: 'vertex' as const, type: 'point', point: [x, y, 0] as [number, number, number] });

const make = (views: DrawingView[], dimensions: Dimension[] = []): DrawingDoc => {
  let d = applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views });
  if (dimensions.length > 0) d = applyDrawingCommand(d, { type: 'insertDimensions', dimensions });
  return d;
};
/** A horizontal dimension of the front view's width, its line `offset` mm below the view (negative: below). */
const width = (offset: number): Dimension => ({ id: 'dim1', view: 'f', kind: 'linear', a: ref('a'), b: ref('b'), orientation: 'horizontal', offset }) as Dimension;
const elements = new Map<string, ElementsResult>([['dim1', { elements: [point(0, 0), point(100, 0)] }]]);

describe('the box round what is drawn', () => {
  it('lines and texts (a text is as wide as the dimension code reckons it), nothing for an empty scene', () => {
    expect(itemsBounds([])).toBeNull();
    const b = itemsBounds([
      { kind: 'polyline', points: [0, 0, 10, 5], style: 'visible' },
      { kind: 'text', at: [20, 2], text: '100', height: 3.5 },
    ])!;
    expect([b.x0, b.y0, b.y1]).toEqual([0, 0, expect.closeTo(5.5, 9)]);
    expect(b.x1).toBeCloseTo(20 + 3 * 3.5 * 0.62, 9);
  });
});

describe('the best scale', () => {
  it('with nothing but views it is the scale of their boxes, as suggestScale says; the name under the lowest view is drawn content, so the arrangement moves up 4 mm to centre it', () => {
    const doc = make([view('f', 'front'), view('t', 'top'), view('r', 'right')]);
    const fit = fitViews(doc, lines)!;
    const sizes = new Map([['f', { w: 100, h: 60 }], ['t', { w: 100, h: 40 }], ['r', { w: 40, h: 60 }]]);
    expect(fit.scale).toEqual(suggestScale(doc.views, sizes, doc.sheet));
    expect(fit.scale).toEqual([1, 1]);
    // each view is named 8 mm under it (ISO 128-30); the lowest is the top view's, 8 below its box, so the drawn content's
    // middle sits 4 mm below the area's and the whole arrangement is shifted 4 mm up (8 / 2).
    expect(fit.shift).toEqual([0, 4]);
  });

  it('a dimension that stands out far from the front view takes room: its line 170 mm below the view (past the top view, which ends 65 below), 1:1 no longer fits (60 + 170 > 213), 1:2 does (30 + 170)', () => {
    const plain = make([view('f', 'front'), view('t', 'top'), view('r', 'right')]);
    const dimensioned = make([view('f', 'front'), view('t', 'top'), view('r', 'right')], [width(-170)]);
    expect(fitViews(plain, lines, elements)!.scale).toEqual([1, 1]);
    expect(fitViews(dimensioned, lines, elements)!.scale).toEqual([1, 2]);
  });

  it('a dimension on one side only leaves the views off the middle of the area: the arrangement is shifted so that the whole is in the middle', () => {
    // the views span 125 high from 65 below the front view's bottom to its top (60 up); the line 100 below the front view and the 2 mm of the extension lines past it go 37 below that
    const doc = make([view('f', 'front'), view('t', 'top'), view('r', 'right')], [width(-100)]);
    const fit = fitViews(doc, lines, elements)!;
    expect(fit.scale).toEqual([1, 1]); // 162 high fits 213
    expect(fit.shift).not.toBeNull();
    expect(fit.shift![0]).toBeCloseTo(0, 1);
    expect(fit.shift![1]).toBeGreaterThan(15); // the whole goes up by half of what hangs below the views (18.5, a little more for the arrowheads)
    expect(fit.shift![1]).toBeLessThan(25);
  });

  it('the shift it gives puts the whole in the middle: the box of what is drawn is centred on the area', () => {
    const doc = applyDrawingCommand(make([view('f', 'front'), view('t', 'top'), view('r', 'right')], [width(-100)]), { type: 'setSheet', sheet: { shift: [0, 0] } });
    const fit = fitViews(doc, lines, elements)!;
    expect(fit.shift![1]).toBeCloseTo(fitViews({ ...doc, sheet: { ...doc.sheet, shift: [50, 50] } }, lines, elements)!.shift![1], 6); // where it is now makes no difference
  });

  it('only the views that take the sheet\'s scale count: one with its own scale or a position of its own is not the sheet\'s business', () => {
    const doc = make([view('f', 'front'), view('t', 'top', { scale: [1, 1] }), view('r', 'right', { at: [300, 100] })]);
    const fit = fitViews(doc, lines)!;
    expect(fit.scale[0] / fit.scale[1]).toBeGreaterThan(1); // the front alone is 100 x 60: it could be much bigger
    expect(fitViews(make([view('f', 'front', { scale: [1, 1] })]), lines)).toBeNull();
  });

  it('what hangs on a view that does not take the sheet\'s scale is left out with it', () => {
    const doc = make([view('f', 'front', { at: [100, 100] }), { id: 'p', name: 'p', kind: 'projected', parent: 'f', side: 'right' } as DrawingView]);
    expect(fitViews(doc, lines)).toBeNull();
  });

  it('when nothing fits it says 1:100', () => {
    const huge = new Map<string, ViewLines>([['f', box(100000, 60000)]]);
    expect(fitViews(make([view('f', 'front')]), huge)!.scale).toEqual([1, 100]);
  });
});

describe('「自動排版」 of the arrangement: back to the middle a new drawing has', () => {
  it('at the scale 最適比例 picks it is the shift 最適比例 gives ([0, 4]: the name under the top view), wherever the arrangement is now', () => {
    const doc = make([view('f', 'front'), view('t', 'top'), view('r', 'right')]);
    expect(centreViews(doc, lines)).toEqual(fitViews(doc, lines)!.shift);
    expect(centreViews(doc, lines)).toEqual([0, 4]);
    const moved = applyDrawingCommand(doc, { type: 'setSheet', sheet: { shift: [30, 24] } });
    expect(centreViews(moved, lines)).toEqual([0, 4]);
  });

  it('at the scale the sheet has, not a better one: at 1:2 the views are half as big and the name stays 5 mm high 8 mm under, so the shift is the same 4 mm', () => {
    const doc = applyDrawingCommand(make([view('f', 'front'), view('t', 'top'), view('r', 'right')]), { type: 'setSheet', sheet: { scale: [1, 2] } });
    expect(fitViews(doc, lines)!.scale).toEqual([1, 1]); // 最適比例 would change the scale; 自動排版 does not
    expect(centreViews(doc, lines)).toEqual([0, 4]);
  });

  it('with a dimension hanging 100 mm under the front view, the same shift as 最適比例 (both centre what is drawn)', () => {
    const doc = make([view('f', 'front'), view('t', 'top'), view('r', 'right')], [width(-100)]);
    const shift = centreViews(doc, lines, elements)!;
    expect(shift).toEqual(fitViews(doc, lines, elements)!.shift);
    expect(shift[1]).toBeGreaterThan(15);
  });

  it('nothing to do when no view takes the sheet\'s scale', () => {
    expect(centreViews(make([view('f', 'front', { scale: [1, 1] })]), lines)).toBeNull();
  });
});
