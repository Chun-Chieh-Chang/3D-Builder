/**
 * B2.7 (2026-10-19): the break view — the band left out of a view so that a long part is drawn shorter.
 *
 * A break is not a kind of view of its own: it is a piecewise map of the view's placement (`layout.ts`), so everything of the view — its lines, its hatching, its
 * dimensions and its annotations — follows it through `toSheet`, and what is left out is left out of all of them at once. Two things are locked here rather than
 * taken on trust:
 *   1. A dimension's value stays the model's: the drawn span is the band shorter, and `fromSheet` gives the model's own length back exactly. (Red team: 斷裂視圖上的
 *      尺寸數值必須是模型長度，不能是圖上的長度.)
 *   2. The lines really are cut at the band: no drawn point lies inside the gap, and a break line is drawn at each end of it.
 */
import { describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, DRAWING_SCHEMA_VERSION, parseDrawing, serializeDrawing, type DrawingDoc, type DrawingView, type ModelDrawingView, page } from '@3db/model';
import { olderDrawingFile } from '../support/drawingVersion';
import { fromSheet, layoutViews, toSheet, viewImage, viewItems, type PlacedView, type ViewLines } from '@3db/drawing';

const front = (extra: Partial<ModelDrawingView> = {}): DrawingView => ({ id: 'front', kind: 'model', name: 'Front', source: 'part.3dbx', direction: 'front', ...extra });

const oneView = (extra: Partial<ModelDrawingView> = {}): DrawingDoc => applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [front(extra)] });

/** A front view of a 40 × 20 plate; the shape is made in the other tests of the suite, which the band does not depend on. */
const LINES: ViewLines = { visible: [[0, 5, 40, 5]], hidden: [], box: { min: [0, 0], max: [40, 20] } };

const placedWith = (brk?: ModelDrawingView['break']): PlacedView => {
  const view = front({ at: [100, 100], ...(brk ? { break: brk } : {}) });
  const doc = applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [view] });
  return layoutViews(doc, new Map([['front', LINES]])).get('front')!;
};

describe('a break is part of the view (B2.7)', () => {
  it('the drawing schema supports this view kind', () => {
    expect(DRAWING_SCHEMA_VERSION).toBeGreaterThanOrEqual(22);
  });

  it('a view with a break inserts, and the band it keeps is what was asked for', () => {
    const doc = oneView({ break: { axis: 'x', from: 10, to: 20 } });
    expect(page(doc).views[0]!.break).toEqual({ axis: 'x', from: 10, to: 20 });
  });

  it('setView sets a break and takes it back with null', () => {
    const doc = oneView();
    const broken = applyDrawingCommand(doc, { type: 'setView', viewId: 'front', patch: { break: { axis: 'y', from: 5, to: 15, gap: 3 } } });
    expect(page(broken).views[0]!.break).toEqual({ axis: 'y', from: 5, to: 15, gap: 3 });
    expect(page(applyDrawingCommand(broken, { type: 'setView', viewId: 'front', patch: { break: null } })).views[0]!.break).toBeUndefined();
  });

  it('an axis that is not x or y is refused', () => {
    expect(() => oneView({ break: { axis: 'z' as 'x', from: 0, to: 5 } })).toThrow(/方向|direction/);
  });

  it('a band with no room in it, or numbers that are not finite, is refused', () => {
    expect(() => oneView({ break: { axis: 'x', from: 20, to: 10 } })).toThrow(/two|兩個/);
    expect(() => oneView({ break: { axis: 'x', from: 0, to: 0 } })).toThrow(/two|兩個/);
    expect(() => oneView({ break: { axis: 'x', from: 0, to: Number.NaN } })).toThrow(/two|兩個/);
    expect(() => oneView({ break: { axis: 'x', from: 0, to: Number.POSITIVE_INFINITY } })).toThrow(/two|兩個/);
  });

  it('a gap that is negative is refused', () => {
    expect(() => oneView({ break: { axis: 'x', from: 0, to: 5, gap: -1 } })).toThrow(/缺口|gap/);
  });

  it('goes with the file: written and read back', () => {
    const doc = applyDrawingCommand(oneView(), { type: 'setView', viewId: 'front', patch: { break: { axis: 'x', from: 10, to: 20, gap: 2 } } });
    expect(page(parseDrawing(serializeDrawing(doc))).views[0]!.break).toEqual({ axis: 'x', from: 10, to: 20, gap: 2 });
  });

  it('a drawing written before the break has none, and still reads (v21 → v22)', () => {
    const raw = JSON.parse(serializeDrawing(oneView())) as { version: number; views: unknown[] };
    raw.version = 21;
    const older = parseDrawing(JSON.stringify(raw));
    expect(page(older).views[0]!.break).toBeUndefined();
    expect(page(older).views).toHaveLength(1);
  });
});

describe('the placement follows the band (B2.7)', () => {
  it('the drawn size is the band shorter, with the gap held between the halves', () => {
    const whole = placedWith();
    const scale = whole.w / 40;
    expect(whole.break).toBeUndefined();
    expect(toSheet(whole, 40, 5)[0] - toSheet(whole, 0, 5)[0]).toBeCloseTo(40 * scale);
    const broken = placedWith({ axis: 'x', from: 10, to: 20, gap: 2 });
    expect(broken.break).toEqual({ axis: 0, from: 10, to: 20, gap: 2 });
    // 40less the 10 the band takes away, plus the 2 the halves are held apart by
    expect(broken.w).toBeCloseTo(32 * scale);
    expect(broken.h).toBeCloseTo(whole.h);
  });

  it('the halves are a gap apart, and the value the model gives back is its own length (red team: no drawing length leaks into it)', () => {
    const scale = placedWith().w / 40;
    const p = placedWith({ axis: 'x', from: 10, to: 20, gap: 2 });
    const x = (v: number) => toSheet(p, v, 5)[0];
    expect(x(20) - x(10)).toBeCloseTo(2 * scale); // the gap between the cut ends
    expect(x(40) - x(20)).toBeCloseTo(20 * scale);
    expect(x(10) - x(0)).toBeCloseTo(10 * scale);
    // the sheet shows 32 mm of a 40 mm part
    expect(x(40) - x(0)).toBeCloseTo(32 * scale);
    // and a measurement taken off the sheet is the model's 40 again, not the drawn 32
    expect(fromSheet(p, x(40), 5)[0] - fromSheet(p, x(0), 5)[0]).toBeCloseTo(40);
    expect(fromSheet(p, x(40), 5)[0]).toBeCloseTo(40);
    expect(fromSheet(p, x(0), 5)[0]).toBeCloseTo(0);
  });

  it('a point outside the band comes back to its own coordinate; a point inside it has nothing drawn at it', () => {
    const p = placedWith({ axis: 'x', from: 10, to: 20, gap: 2 });
    for (const v of [0, 5, 10, 20, 25, 40]) expect(fromSheet(p, toSheet(p, v, 5)[0], 5)[0], `x=${v}`).toBeCloseTo(v);
    // inside the band the drawn coordinate is the near end of it: there is no line to point at there
    expect(toSheet(p, 15, 5)[0]).toBeCloseTo(toSheet(p, 10, 5)[0]);
  });
});

describe('the scene cuts the lines and draws the break lines (B2.7)', () => {
  const view: DrawingView = front({ break: { axis: 'x', from: 10, to: 20, gap: 2 } });
  const placed: PlacedView = { id: 'front', at: [100, 100], scale: 1, w: 32, h: 20, centre: [16, 10], break: { axis: 0, from: 10, to: 20, gap: 2 } };
  /** Where the drawn points of the items of one style lie, along the broken axis. */
  const along = (items: { points: number[] }[]) => items.flatMap((i) => i.points.filter((_, k) => k % 2 === 0)).sort((a, b) => a - b);

  it('a line crossing the band is cut at its ends rather than drawn across the gap', () => {
    const visible = viewItems(view, LINES, placed).filter((i) => i.style === 'visible');
    expect(visible).toHaveLength(2); // the near half and the far half, not one line through the gap
    const xs = along(visible);
    expect(xs).toHaveLength(4);
    expect(xs[0]).toBeCloseTo(84); // 100 + (0 − 16): the near half starts where the model does
    expect(xs[1]).toBeCloseTo(94); // and ends at the band's near end
    expect(xs[2]).toBeCloseTo(96); // the far half starts a gap later
    expect(xs[3]).toBeCloseTo(116); // and reaches the model's far end
  });

  it('a break line is drawn at each end of the gap, across the view', () => {
    const thin = viewItems(view, LINES, placed).filter((i) => i.style === 'thin');
    expect(thin).toHaveLength(2);
    // the zigzag leans either way of the cut, so the cut is the middle of what it spans
    const mid = (p: number[]) => {
      const xs = p.filter((_, k) => k % 2 === 0);
      return (Math.min(...xs) + Math.max(...xs)) / 2;
    };
    const cuts = thin.map((i) => mid(i.points)).sort((a, b) => a - b);
    expect(cuts[0]).toBeCloseTo(94);
    expect(cuts[1]).toBeCloseTo(96);
    for (const i of thin) {
      const ys = i.points.filter((_, k) => k % 2 === 1);
      expect(Math.min(...ys)).toBeCloseTo(87); // the view's box (0…20), a little past each side, where the placement puts it
      expect(Math.max(...ys)).toBeCloseTo(113);
    }
  });

  it('a view with no break draws neither, and is placed as before', () => {
    const plain: PlacedView = { id: 'front', at: [100, 100], scale: 1, w: 40, h: 20, centre: [20, 10] };
    const items = viewItems(front(), LINES, plain);
    expect(items.filter((i) => i.style === 'thin')).toHaveLength(0);
    expect(items.filter((i) => i.style === 'visible')).toHaveLength(1);
    expect(toSheet(plain, 40, 5)[0] - toSheet(plain, 0, 5)[0]).toBeCloseTo(40);
  });

  it('a broken view is not shaded: the image is one picture of the whole part and cannot be cut at the band', () => {
    const img = { width: 1, height: 1, box: { min: [0, 0] as [number, number], max: [1, 1] as [number, number] }, png: new Uint8Array(), rgb: new Uint8Array([0, 0, 0]), alpha: new Uint8Array([255]) };
    const shaded: ViewLines = { ...LINES, shade: img };
    const whole: PlacedView = { id: 'front', at: [100, 100], scale: 1, w: 40, h: 20, centre: [20, 10] };
    expect(viewImage(front({ display: 'shadedEdges' }), shaded, whole)).not.toBeNull();
    expect(viewImage(view, shaded, placed)).toBeNull();
  });
});
