/**
 * A linear dimension whose line is drawn on the view (ADR 0227) instead of outside it: the place on the view is kept in the view's own millimetres, so it stays
 * on the part when the view is scaled; the arrows touch the contour and no extension line is drawn, except where the contour stops short of the line or the
 * feature is a point, which an extension line then joins to the line; and the number is the one the dimension outside the view gives.
 *
 * The part is a turned pin seen from the side, as in the drawing the question was asked about: its axis runs across the view at y = 30, the Ø10.54 section from
 * x = 60 to x = 90 (its two end faces), and the Ø was written outside the view on the right. The view is 100 x 60 at the sheet point (200, 150), scale 1, its
 * own origin (0, 0) at the lower left corner of its box — so the box is x 150 to 250, y 120 to 180 on the sheet.
 */
import { describe, expect, it } from 'vitest';
import { applyDrawingCommand, CommandError, createEmptyDrawing, DRAWING_SCHEMA_VERSION, page, parseDrawing, serializeDrawing, viewVectors, type Dimension, type DrawingView, type ElementFacts, type ViewAxes } from '@3db/model';
import { DIM_TEXT, dimensionTextItems, dragDimension, evaluateDimension, GAP, insideAt, OVERSHOOT, toSheet, type PlacedView, type SceneItem, type ViewLines } from '@3db/drawing';

const placed: PlacedView = { id: 'v', at: [200, 150], scale: 1, w: 100, h: 60, centre: [50, 30] };
const axes: ViewAxes = viewVectors('front');
const R = 5.27; // Ø10.54
const AXIS_Y = 30;
/** The pin's Ø10.54 section, seen from the side: its axis across the view, its radius R. */
const cylinder: ElementFacts = { kind: 'face', type: 'cylinder', point: [50, AXIS_Y, 0], dir: [1, 0, 0], radius: R };
/** The Ø of the section: a distance from the top of the outline to the bottom of it, written as a diameter. */
const diameter = (extra: Partial<Dimension> = {}): Dimension =>
  ({ id: 'd', view: 'v', kind: 'linear', a: { kind: 'face', name: 'cyl' }, b: { kind: 'face', name: 'cyl' }, orientation: 'vertical', offset: 20, aSide: 1, bSide: -1, prefix: 'Ø', ...extra }) as Dimension;

const run = (d: Dimension) => evaluateDimension(d, { elements: [cylinder, cylinder] }, axes, placed);
const items = (d: Dimension): SceneItem[] => {
  const o = run(d);
  if (!('items' in o)) throw new Error(o.error);
  return o.items;
};
/** The dimension line: the polyline that is not an arrowhead (which is a closed one) and not an extension line (which is across the dimension). */
const line = (d: Dimension): number[] => {
  const open = items(d).filter((i) => i.kind === 'polyline' && !i.closed) as { kind: 'polyline'; points: number[] }[];
  const vertical = open.filter((p) => p.points.length === 4 && p.points[0] === p.points[2]);
  expect(vertical.length).toBe(1);
  return vertical[0]!.points;
};
/** How many lines are drawn without the arrows: the dimension line and the extension lines. */
const openLines = (d: Dimension): number => items(d).filter((i) => i.kind === 'polyline' && !i.closed).length;

describe('the line of a linear dimension drawn on the view', () => {
  it('is where the place on the view is, between the two end faces of the section', () => {
    // the place is the x of the section's middle (75), in the view's own millimetres
    const d = diameter({ insideAt: 75 });
    const points = line(d);
    expect(points[0]).toBeCloseTo(toSheet(placed, 75, 0)[0], 9);
    expect(points[2]).toBeCloseTo(toSheet(placed, 75, 0)[0], 9);
    // the section runs from x = 60 to x = 90, so the line is between its two end faces
    expect(points[0]!).toBeGreaterThan(toSheet(placed, 60, 0)[0]!);
    expect(points[0]!).toBeLessThan(toSheet(placed, 90, 0)[0]!);
    // and it spans the outline of the cylinder, from its top to its bottom
    expect(points[1]).toBeCloseTo(toSheet(placed, 50, AXIS_Y + R)[1], 9);
    expect(points[3]).toBeCloseTo(toSheet(placed, 50, AXIS_Y - R)[1], 9);
  });

  it('has no extension line: the arrows touch the contour itself', () => {
    // outside the view the line is drawn with two extension lines; on the view there is none, for it would lie on the outline
    expect(openLines(diameter())).toBe(3);
    expect(openLines(diameter({ insideAt: 75 }))).toBe(1);
  });

  it('gives the same number as the dimension outside the view', () => {
    const outside = run(diameter());
    const inside = run(diameter({ insideAt: 75 }));
    if (!('value' in outside) || !('value' in inside)) throw new Error('no value');
    expect(inside.value).toBeCloseTo(outside.value, 9);
    expect(inside.value).toBeCloseTo(10.54, 9);
    expect(inside.text).toBe(outside.text);
    expect(inside.text).toBe('Ø10.54');
  });

  it('keeps its place on the part when the view is scaled', () => {
    const scaled: PlacedView = { ...placed, scale: 2 };
    const d = diameter({ insideAt: 75 });
    const o = evaluateDimension(d, { elements: [cylinder, cylinder] }, axes, scaled);
    if (!('items' in o)) throw new Error(o.error);
    const open = o.items.filter((i) => i.kind === 'polyline' && !i.closed) as { kind: 'polyline'; points: number[] }[];
    expect(open[0]!.points[0]).toBeCloseTo(toSheet(scaled, 75, 0)[0], 9);
  });

  it('outside the view, the line is where the offset puts it, as it was', () => {
    const points = line(diameter({ offset: 20 }));
    expect(points[0]).toBeCloseTo(270, 9); // the box's right edge (250) and 20 beyond it
    expect(points[2]).toBeCloseTo(270, 9);
  });
});

describe('an extension line on the view, where the contour does not reach the line', () => {
  // The section's outline as the view draws it: its top and bottom silhouettes from its end face at x = 60 to the one at x = 90.
  const lines: ViewLines = { visible: [[60, AXIS_Y + R, 90, AXIS_Y + R], [60, AXIS_Y - R, 90, AXIS_Y - R]], hidden: [], box: { min: [0, 0], max: [100, 60] } };
  const openOf = (d: Dimension, viewLines: ViewLines | null = lines) => {
    const o = evaluateDimension(d, { elements: [cylinder, cylinder] }, axes, placed, 'mm', undefined, viewLines);
    if (!('items' in o)) throw new Error(o.error);
    return (o.items.filter((i) => i.kind === 'polyline' && !i.closed) as { kind: 'polyline'; points: number[] }[]).map((p) => p.points);
  };
  const horizontals = (d: Dimension, viewLines?: ViewLines | null) => openOf(d, viewLines).filter((p) => p.length === 4 && p[1] === p[3]);

  it('is not drawn where the contour crosses the line: the arrows touch it', () => {
    expect(openOf(diameter({ insideAt: 75 }))).toHaveLength(1);
    // either end of the outline is still on it
    expect(openOf(diameter({ insideAt: 60 }))).toHaveLength(1);
    expect(openOf(diameter({ insideAt: 90 }))).toHaveLength(1);
  });

  it('runs from the end of the contour nearest the line, a gap off it, to a little past the line', () => {
    // the line at x = 40 is left of the section's end face at x = 60: the arrows would touch nothing there
    const ext = horizontals(diameter({ insideAt: 40 }));
    expect(ext).toHaveLength(2);
    const lineX = toSheet(placed, 40, 0)[0];
    for (const [y, p] of [[AXIS_Y + R, ext.find((q) => q[1]! > 150)!], [AXIS_Y - R, ext.find((q) => q[1]! < 150)!]] as const) {
      expect(p[1]).toBeCloseTo(toSheet(placed, 0, y)[1], 9);
      expect(p[0]).toBeCloseTo(toSheet(placed, 60, 0)[0] - GAP, 9);
      expect(p[2]).toBeCloseTo(lineX - OVERSHOOT, 9);
    }
    // the dimension line's ends (the arrow tips) lie on the extension lines
    const dim = line(diameter({ insideAt: 40 }));
    expect(dim[0]).toBeCloseTo(lineX, 9);
    expect(Math.max(dim[1]!, dim[3]!)).toBeCloseTo(toSheet(placed, 0, AXIS_Y + R)[1], 9);
  });

  it('runs the other way past the far end of the contour', () => {
    const ext = horizontals(diameter({ insideAt: 98 }));
    expect(ext).toHaveLength(2);
    for (const p of ext) {
      expect(p[0]).toBeCloseTo(toSheet(placed, 90, 0)[0] + GAP, 9);
      expect(p[2]).toBeCloseTo(toSheet(placed, 98, 0)[0] + OVERSHOOT, 9);
    }
  });

  it('is not guessed for an outline whose extent the view lines do not show', () => {
    expect(openOf(diameter({ insideAt: 40 }), null)).toHaveLength(1);
  });

  it('runs from a point feature, which has no contour, to the line', () => {
    // two vertices 30 apart across the view at y = 10 and y = 20; the line on the view at y = 45
    const v1: ElementFacts = { kind: 'vertex', type: 'point', point: [20, 10, 0] }, v2: ElementFacts = { kind: 'vertex', type: 'point', point: [50, 20, 0] };
    const d = { id: 'p', view: 'v', kind: 'linear', a: { kind: 'vertex', name: 'v1' }, b: { kind: 'vertex', name: 'v2' }, orientation: 'horizontal', offset: 20, insideAt: 45 } as Dimension;
    const o = evaluateDimension(d, { elements: [v1, v2] }, axes, placed, 'mm', undefined, { visible: [], hidden: [], box: null });
    if (!('items' in o)) throw new Error(o.error);
    expect(o.value).toBeCloseTo(30, 9);
    const verticals = (o.items.filter((i) => i.kind === 'polyline' && !i.closed) as { points: number[] }[]).map((p) => p.points).filter((p) => p.length === 4 && p[0] === p[2]);
    expect(verticals).toHaveLength(2);
    const lineY = toSheet(placed, 0, 45)[1];
    for (const [x, y] of [[20, 10], [50, 20]] as const) {
      const p = verticals.find((q) => Math.abs(q[0]! - toSheet(placed, x, 0)[0]) < 1e-9)!;
      expect(p[1]).toBeCloseTo(toSheet(placed, 0, y)[1] + GAP, 9);
      expect(p[3]).toBeCloseTo(lineY + OVERSHOOT, 9);
    }
  });
});

describe('a text slid out beyond an arrow', () => {
  // The Ø10.54 on the view between the end faces, its number slid up off the section (the line runs from the top of the outline down, so up is a negative slide).
  const width = dimensionTextItems(['Ø10.54'], [0, 0], DIM_TEXT, 'center').width;
  const top = toSheet(placed, 0, AXIS_Y + R)[1], bottom = toSheet(placed, 0, AXIS_Y - R)[1];
  const span = (p: number[]) => [Math.min(p[1]!, p[3]!), Math.max(p[1]!, p[3]!)];

  it('has the dimension line drawn on under it, to its far end, on the view and outside it', () => {
    for (const where of [{ insideAt: 75 }, {}]) {
      const [lo, hi] = span(line(diameter({ ...where, slide: -20 })));
      // the text's middle is 20 above the line's middle (10.54 / 2 below the top arrow), and it reaches half its width further
      expect(hi).toBeCloseTo(top + (20 - R) + width / 2, 9);
      expect(lo).toBeCloseTo(bottom, 9);
    }
  });

  it('leaves the line between the arrows when the text only overhangs them, its middle between them', () => {
    // Ø10.54 is wider than the 10.54 it gives, so centred it overhangs both arrows; the line is not drawn on for that
    expect(width).toBeGreaterThan(2 * R);
    for (const slide of [0, -3, 3]) {
      const [lo, hi] = span(line(diameter({ insideAt: 75, slide })));
      expect(hi).toBeCloseTo(top, 9);
      expect(lo).toBeCloseTo(bottom, 9);
    }
  });

  it('has the line drawn on the other way when it is slid past the other arrow', () => {
    const [lo, hi] = span(line(diameter({ insideAt: 75, slide: 20 })));
    expect(lo).toBeCloseTo(bottom - (20 - R) - width / 2, 9);
    expect(hi).toBeCloseTo(top, 9);
  });
});

describe('the pointer and the line of a linear dimension', () => {
  const handle = () => {
    const o = run(diameter());
    if (!('handle' in o) || !o.handle) throw new Error('no handle');
    return o.handle;
  };

  it('over the view the line is put on it, at the place the pointer is at', () => {
    expect(dragDimension(handle(), false, [toSheet(placed, 75, 0)[0], 150])).toEqual({ insideAt: 75 });
    expect(dragDimension(handle(), false, [toSheet(placed, 70, 0)[0], 150])).toEqual({ insideAt: 70 });
  });

  it('off the view the line stays outside it, at the distance the pointer is at', () => {
    expect(dragDimension(handle(), false, [270, 150])).toEqual({ offset: 20 });
    expect(dragDimension(handle(), false, [130, 150])).toEqual({ offset: -20 });
  });

  it('the text of a dimension still slides along its line', () => {
    // the line runs from the first element (the top of the outline) to the second (the bottom), so the text slides down as the pointer moves up
    expect(dragDimension(handle(), true, [215, 195])).toEqual({ slide: -45 });
  });

  it('the place is the view own millimetres, and none when the pointer is off the view', () => {
    const h = handle();
    if (h.kind !== 'linear') throw new Error('not a linear handle');
    expect(insideAt(h, [toSheet(placed, 75, 0)[0], 150])).toBe(75);
    expect(insideAt(h, [270, 150])).toBeNull();
  });
});

describe('the command that puts a dimension line on the view', () => {
  const views: DrawingView[] = [{ id: 'view1', name: '前視', source: 'part', direction: 'front' }];
  const base = (): Dimension => ({ id: 'd1', view: 'view1', kind: 'linear', a: { kind: 'face', name: 'f1' }, b: { kind: 'face', name: 'f2' }, orientation: 'vertical', offset: 20 } as Dimension);
  const doc = () => {
    let d = applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views });
    d = applyDrawingCommand(d, { type: 'insertDimensions', dimensions: [base()] });
    return d;
  };
  const of = (d: ReturnType<typeof doc>) => page(d).dimensions.find((x) => x.id === 'd1') as Extract<Dimension, { kind: 'linear' }>;

  it('puts the line on the view and keeps it there', () => {
    const d = applyDrawingCommand(doc(), { type: 'setDimension', dimensionId: 'd1', patch: { insideAt: 12.5 } });
    expect(of(d).insideAt).toBe(12.5);
  });

  it('takes the line off the view when the distance outside it is given', () => {
    const d = applyDrawingCommand(doc(), { type: 'setDimension', dimensionId: 'd1', patch: { insideAt: 12.5 } });
    const back = applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'd1', patch: { offset: 30 } });
    expect(of(back).insideAt).toBeUndefined();
    expect(of(back).offset).toBe(30);
  });

  it('takes the place away on its own, and the line goes back outside where it was', () => {
    const d = applyDrawingCommand(doc(), { type: 'setDimension', dimensionId: 'd1', patch: { insideAt: 12.5 } });
    const back = applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'd1', patch: { insideAt: null } });
    expect(of(back).insideAt).toBeUndefined();
    expect(of(back).offset).toBe(20);
  });

  it('refuses a place that is not a number, and a dimension whose line is not square to the view', () => {
    expect(() => applyDrawingCommand(doc(), { type: 'setDimension', dimensionId: 'd1', patch: { insideAt: Number.NaN } })).toThrow(CommandError);
    expect(() => applyDrawingCommand(doc(), { type: 'setDimension', dimensionId: 'd1', patch: { insideAt: Number.POSITIVE_INFINITY } })).toThrow(CommandError);
    expect(() => applyDrawingCommand(doc(), { type: 'setDimension', dimensionId: 'd1', patch: { orientation: 'aligned', insideAt: 3 } })).toThrow(CommandError);
  });

  it('refuses a place for a dimension that has no line to put on the view', () => {
    let d = applyDrawingCommand(doc(), { type: 'insertDimensions', dimensions: [{ id: 'd2', view: 'view1', kind: 'diameter', ref: { kind: 'face', name: 'f1' }, angle: 0 } as Dimension] });
    expect(() => applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'd2', patch: { insideAt: 3 } })).toThrow(CommandError);
  });

  it('is written with the drawing and read back, and an older drawing still opens', () => {
    const d = applyDrawingCommand(doc(), { type: 'setDimension', dimensionId: 'd1', patch: { insideAt: 12.5 } });
    const written = JSON.parse(serializeDrawing(d)) as { schemaVersion: number };
    expect(written.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
    const back = parseDrawing(JSON.stringify(written));
    const dim = page(back).dimensions.find((x) => x.id === 'd1') as Extract<Dimension, { kind: 'linear' }>;
    expect(dim.insideAt).toBe(12.5);
    // a drawing written before the place existed opens as it was
    const old = { ...written, schemaVersion: DRAWING_SCHEMA_VERSION - 1 };
    expect(page(parseDrawing(JSON.stringify(old))).dimensions.find((x) => x.id === 'd1')).toBeDefined();
  });
});
