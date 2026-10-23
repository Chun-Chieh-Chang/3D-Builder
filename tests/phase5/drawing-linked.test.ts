/**
 * Views that are in line move together (schema 7): the shift of the whole arrangement, the slide of a view along its line (the distance to the others), what hangs on a
 * moved view, the scale a drag gives, and the document: the commands, the file. The positions are worked out by hand from the layout of drawing-layout.test.ts
 * (front 100 x 60, top 100 x 40, right 40 x 60, gap 25, first angle: front at (247.5, 205), top below it at (247.5, 130), right to its left at (152.5, 205)).
 */
import { describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, DRAWING_SCHEMA_VERSION, parseDrawing, serializeDrawing, type DrawingDoc, type DrawingView, type ModelDrawingView, page } from '@3db/model';
import { olderDrawingFile } from '../support/drawingVersion';
import { arrangementBase, layoutViews, scaleFromRatio, scaleTarget, slideAxis, type ViewLines } from '@3db/drawing';

const view = (id: string, direction: ModelDrawingView['direction'], extra: Partial<ModelDrawingView> = {}): DrawingView => ({ id, name: id, source: 'x.3dbx', direction, ...extra });
const doc = (views: DrawingView[], sheet: Parameters<typeof applyDrawingCommand>[1] extends infer C ? (C extends { type: 'setSheet'; sheet: infer S } ? S : never) : never = {}): DrawingDoc =>
  applyDrawingCommand(applyDrawingCommand(createEmptyDrawing(), { type: 'setSheet', sheet }), { type: 'insertViews', views });
const box = (w: number, h: number): ViewLines => ({ visible: [[0, 0, w, h]], hidden: [], box: { min: [0, 0], max: [w, h] } });
const lines = new Map<string, ViewLines>([['f', box(100, 60)], ['t', box(100, 40)], ['r', box(40, 60)], ['p', box(100, 40)]]);
const views = [view('f', 'front'), view('t', 'top'), view('r', 'right')];
const near = (a: [number, number], x: number, y: number) => expect(a).toEqual([expect.closeTo(x, 9), expect.closeTo(y, 9)]);

describe('the lines views are in line on', () => {
  const d = doc(views);
  it('the front view is what the others are arranged round; the top slides up and down, the right sideways; the isometric view has no line', () => {
    expect(arrangementBase(d)?.id).toBe('f');
    expect([slideAxis(d, page(d).views[0]!), slideAxis(d, page(d).views[1]!), slideAxis(d, page(d).views[2]!)]).toEqual([null, 1, 0]);
    expect(slideAxis(doc([view('f', 'front'), view('i', 'isometric')]), view('i', 'isometric'))).toBeNull();
  });

  it('a projected view slides along its side, a detail has no line, a view with a position of its own none', () => {
    const e = doc([...views, { id: 'p', name: 'p', kind: 'projected', parent: 'f', side: 'right' }, { id: 'd', name: 'd', kind: 'detail', parent: 'f', centre: [0, 0], radius: 5, label: 'B' }, view('x', 'back', { at: [100, 100] })]);
    expect([slideAxis(e, page(e).views[3]!), slideAxis(e, page(e).views[4]!), slideAxis(e, page(e).views[5]!)]).toEqual([0, null, null]);
  });
});

describe('moving what is laid out together', () => {
  it('nothing moved: as before', () => {
    const p = layoutViews(doc(views), lines);
    near(p.get('f')!.at, 247.5, 205);
    near(p.get('t')!.at, 247.5, 130);
    near(p.get('r')!.at, 152.5, 205);
  });

  it('the shift of the sheet moves every view of the arrangement by the same amount', () => {
    const p = layoutViews(doc(views, { shift: [10, -7] }), lines);
    near(p.get('f')!.at, 257.5, 198);
    near(p.get('t')!.at, 257.5, 123);
    near(p.get('r')!.at, 162.5, 198);
  });

  it('the slide of the top view changes the distance to the front view and nothing else: it stays in line (same x), the others stay put', () => {
    const p = layoutViews(doc([view('f', 'front'), view('t', 'top', { slide: -15 }), view('r', 'right')]), lines);
    near(p.get('f')!.at, 247.5, 205);
    near(p.get('t')!.at, 247.5, 115); // 15 further down: 40 apart instead of 25
    near(p.get('r')!.at, 152.5, 205);
  });

  it('the slide of the right view is sideways only', () => {
    const p = layoutViews(doc([view('f', 'front'), view('t', 'top'), view('r', 'right', { slide: -30 })]), lines);
    near(p.get('r')!.at, 122.5, 205);
    near(p.get('t')!.at, 247.5, 130);
  });

  it('the slide does not move the arrangement (the centring is of where the views would be): the front view stays', () => {
    const p = layoutViews(doc([view('f', 'front'), view('t', 'top', { slide: -200 }), view('r', 'right', { slide: -200 })]), lines);
    near(p.get('f')!.at, 247.5, 205);
  });

  it('a view projected from a view that was slid goes with it, and keeps its own distance', () => {
    const e = doc([view('f', 'front'), view('t', 'top', { slide: -15 }), { id: 'p', name: 'p', kind: 'projected', parent: 't', side: 'right', slide: 5 }, view('r', 'right')]);
    const p = layoutViews(e, lines);
    const unmoved = layoutViews(doc([view('f', 'front'), view('t', 'top'), { id: 'p', name: 'p', kind: 'projected', parent: 't', side: 'right' }, view('r', 'right')]), lines);
    const dx = p.get('p')!.at[0] - unmoved.get('p')!.at[0];
    const dy = p.get('p')!.at[1] - unmoved.get('p')!.at[1];
    expect([dx, dy]).toEqual([expect.closeTo(5, 9), expect.closeTo(-15, 9)]);
  });

  it('the shift takes what is projected from the front view along; a view with a position of its own stays where it was put, and what hangs on it with it', () => {
    const e = doc([...views, view('b', 'back', { at: [300, 100] }), { id: 'p', name: 'p', kind: 'projected', parent: 'b', side: 'up' }], { shift: [10, 10] });
    const p = layoutViews(e, lines);
    near(p.get('b')!.at, 300, 100);
    const q = layoutViews(doc([...views, view('b', 'back', { at: [300, 100] }), { id: 'p', name: 'p', kind: 'projected', parent: 'b', side: 'up' }]), lines);
    near(p.get('p')!.at, q.get('p')!.at[0], q.get('p')!.at[1]);
  });

  it('the scale of the sheet scales every view that takes it, and the others are pushed out by it (the gaps stay the gap)', () => {
    const p = layoutViews(doc(views, { scale: [1, 2] }), lines);
    // half size: front 50 x 30, top 50 x 20, right 20 x 30
    near([p.get('f')!.at[0] - p.get('t')!.at[0], p.get('f')!.at[1] - p.get('t')!.at[1]], 0, 15 + 25 + 10);
    near([p.get('f')!.at[0] - p.get('r')!.at[0], p.get('f')!.at[1] - p.get('r')!.at[1]], 25 + 25 + 10, 0);
  });
});

describe('the scale a drag gives', () => {
  it('near a standard scale it is that scale', () => {
    expect(scaleFromRatio(1.02)).toEqual([1, 1]);
    expect(scaleFromRatio(0.49)).toEqual([1, 2]);
    expect(scaleFromRatio(2.05)).toEqual([2, 1]);
  });

  it('between them it is the plain fraction', () => {
    expect(scaleFromRatio(0.7)).toEqual([5, 7]);
    expect(scaleFromRatio(1.5)).toEqual([3, 2]);
    expect(scaleFromRatio(0.4)).toEqual([2, 5]);
  });

  it('whatever the pointer does, it is a scale a drawing may have', () => {
    for (const r of [0, -3, NaN, Infinity, 1e-9, 1e9, 0.123456, 7.77]) {
      const s = scaleFromRatio(r);
      expect(s.every((n) => Number.isInteger(n) && n >= 1 && n <= 1000)).toBe(true);
    }
  });

  it('the scale of a view is changed where it comes from: its own, its parent’s, or the sheet’s', () => {
    const e = doc([view('f', 'front'), view('t', 'top', { scale: [2, 1] }), { id: 'p', name: 'p', kind: 'projected', parent: 't', side: 'right' }, { id: 'q', name: 'q', kind: 'projected', parent: 'f', side: 'down' }]);
    expect(scaleTarget(e, page(e).views[0]!)).toEqual({ sheet: true });
    expect(scaleTarget(e, page(e).views[1]!)).toEqual({ view: 't' });
    expect(scaleTarget(e, page(e).views[2]!)).toEqual({ view: 't' });
    expect(scaleTarget(e, page(e).views[3]!)).toEqual({ sheet: true });
  });
});

describe('the document', () => {
  it('setSheet takes a shift and, with null (or none), takes it back', () => {
    let d = applyDrawingCommand(createEmptyDrawing(), { type: 'setSheet', sheet: { shift: [4, -2] } });
    expect(page(d).sheet.shift).toEqual([4, -2]);
    d = applyDrawingCommand(d, { type: 'setSheet', sheet: { scale: [1, 2] } });
    expect(page(d).sheet.shift).toEqual([4, -2]); // untouched by the other fields
    d = applyDrawingCommand(d, { type: 'setSheet', sheet: { shift: null } });
    expect('shift' in page(d).sheet).toBe(false);
    expect(() => applyDrawingCommand(d, { type: 'setSheet', sheet: { shift: [NaN, 0] } })).toThrow();
  });

  it('setView takes a slide, and 0 or null takes it back; it has to be a number', () => {
    let d = doc(views);
    d = applyDrawingCommand(d, { type: 'setView', viewId: 't', patch: { slide: -12 } });
    expect(page(d).views.find((v) => v.id === 't')!.slide).toBe(-12);
    d = applyDrawingCommand(d, { type: 'setView', viewId: 't', patch: { slide: 0 } });
    expect(page(d).views.find((v) => v.id === 't')!.slide).toBeUndefined();
    d = applyDrawingCommand(d, { type: 'setView', viewId: 't', patch: { slide: 3 } });
    d = applyDrawingCommand(d, { type: 'setView', viewId: 't', patch: { slide: null, at: [100, 100] } });
    expect(page(d).views.find((v) => v.id === 't')).toMatchObject({ at: [100, 100] });
    expect(page(d).views.find((v) => v.id === 't')!.slide).toBeUndefined();
    expect(() => applyDrawingCommand(d, { type: 'setView', viewId: 't', patch: { slide: NaN } })).toThrow();
  });

  it('the file keeps the shift and the slides; a version-6 file is read as it is and comes out as version 7', () => {
    const d = applyDrawingCommand(applyDrawingCommand(doc(views), { type: 'setSheet', sheet: { shift: [3, 4] } }), { type: 'setView', viewId: 'r', patch: { slide: -8 } });
    const back = parseDrawing(serializeDrawing(d));
    expect(back.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
    expect(DRAWING_SCHEMA_VERSION).toBeGreaterThanOrEqual(7);
    expect(page(back).sheet.shift).toEqual([3, 4]);
    expect(page(back).views.find((v) => v.id === 'r')!.slide).toBe(-8);
    const read = parseDrawing(JSON.stringify(olderDrawingFile(doc(views), 6)));
    expect(read.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
    expect(layoutViews(read, lines).get('t')!.at).toEqual(layoutViews(doc(views), lines).get('t')!.at);
  });
});
