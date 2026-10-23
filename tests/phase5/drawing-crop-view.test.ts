/**
 * B2.7 (2026-10-19): the cropped view — the part of a local section inside a closed outline, set out as a view of its own (SolidWorks's cropped view).
 *
 * A cropped view is a kind of view of its own (`crop`), not a placement trick: its lines are its parent's own lines clipped to the outline (`layout.ts`), so its
 * dimensions follow the same elements and its scale follows its parent's. Three things are locked here rather than taken on trust:
 *   1. Its parent must be a local (partial) section. Cropping anything else is refused at the model layer — cropping a model view would mean cropping what is
 *      already on the sheet, and cropping a plain section would mean cropping a cut that has no outline to crop — rather than left to draw a wrong region.
 *   2. Nothing is cut: the lines are the parent's own (visible/hidden/centre/tangent) clipped to the outline, and the view's box is the outline's — the view is
 *      exactly as big as the region it shows, whatever the parent's box is. The parent's cut faces are carried over so that they are hatched.
 *   3. It is not shaded: a crop's picture cannot be cut at the outline (the sheet's images are cut to a circle only), so no image is carried or drawn, and a view
 *      that *is* shaded does get one from the same lines — the null is the crop's doing, not the lines'.
 */
import { describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, DRAWING_SCHEMA_VERSION, parseDrawing, serializeDrawing, type CropDrawingView, type DrawingDoc, type DrawingView, page } from '@3db/model';
import { olderDrawingFile } from '../support/drawingVersion';
import { buildScene, layoutViews, resolveLines, scaleOf, scaleTarget, viewImage, viewItems, type ShadeImage, type ViewLines } from '@3db/drawing';

/** A front view of a plate, and the local section that cuts a 20 × 20 rectangle out of it — the parent a crop is made from. */
const cut = (sectionScale?: [number, number]): DrawingDoc =>
  applyDrawingCommand(createEmptyDrawing(), {
    type: 'insertViews',
    views: [
      { id: 'view1', kind: 'model', name: 'Front', source: 'part.3dbx', direction: 'front' },
      {
        id: 'localsec1',
        kind: 'sectionLocal',
        name: 'Local A-A',
        parent: 'view1',
        outline: { kind: 'rectangle', p0: [0, 0], p1: [20, 20] },
        depth: 5,
        label: 'A',
        ...(sectionScale ? { scale: sectionScale } : {}),
      },
    ],
  });

/** A view of just the front view, for the parents a crop may not have. */
const plainModelView = (): DrawingDoc =>
  applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'view1', kind: 'model', name: 'Front', source: 'part.3dbx', direction: 'front' }] });

/** A front view and a plain (full) section of it: a cut that a crop may not be made from. */
const withPlainSection = (): DrawingDoc =>
  applyDrawingCommand(plainModelView(), {
    type: 'insertViews',
    views: [{ id: 'sec1', kind: 'section', name: 'A-A', parent: 'view1', line: [[0, 0], [30, 0]], label: 'A' }],
  });

const cropView = (overrides: Partial<CropDrawingView> = {}): CropDrawingView => ({
  id: 'crop1',
  kind: 'crop',
  name: 'Cropped view',
  parent: 'localsec1',
  outline: { kind: 'rectangle', p0: [0, 0], p1: [20, 20] },
  ...overrides,
});

const insertCrop = (doc: DrawingDoc, v: CropDrawingView = cropView()) => applyDrawingCommand(doc, { type: 'insertViews', views: [v] });

/** What the local section shows: a 40 × 20 plate, a visible line across it at y = 5, and two cut faces (closed outlines) to hatch. */
const LINES: ViewLines = {
  visible: [[0, 5, 40, 5]],
  hidden: [],
  cut: [
    [0, 5, 20, 5, 20, 15, 0, 15, 0, 5],
    [2, 8, 8, 8, 8, 12, 2, 12, 2, 8],
  ],
  box: { min: [0, 0], max: [40, 20] },
};

const onePixel = (): ShadeImage => ({ width: 1, height: 1, box: { min: [0, 0], max: [40, 20] }, png: new Uint8Array(0), rgb: new Uint8Array(0), alpha: new Uint8Array(0) });

describe('the cropped view (B2.7)', () => {
  it('the drawing schema supports this view kind', () => {
    expect(DRAWING_SCHEMA_VERSION).toBeGreaterThanOrEqual(23);
  });

  it('a crop of a local section inserts and keeps its outline and parent', () => {
    const v = page(insertCrop(cut(), cropView())).views.find((x) => x.id === 'crop1')! as CropDrawingView;
    expect(v.kind).toBe('crop');
    expect(v.parent).toBe('localsec1');
    expect(v.outline).toEqual({ kind: 'rectangle', p0: [0, 0], p1: [20, 20] });
  });

  it('circle and polygon outlines are accepted', () => {
    const circle = page(insertCrop(cut(), cropView({ outline: { kind: 'circle', centre: [10, 10], radius: 8 } }))).views.find((x) => x.id === 'crop1')! as CropDrawingView;
    expect(circle.outline).toMatchObject({ kind: 'circle', centre: [10, 10], radius: 8 });
    const poly = page(insertCrop(cut(), cropView({ outline: { kind: 'polygon', points: [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]] } }))).views.find((x) => x.id === 'crop1')! as CropDrawingView;
    expect(poly.outline.kind).toBe('polygon');
    expect((poly.outline as { points: [number, number][] }).points).toHaveLength(5);
  });

  it('a crop whose parent is a model view is refused', () => {
    expect(() => insertCrop(cut(), cropView({ parent: 'view1' }))).toThrow(/局部剖視圖|local section/);
  });

  it('a crop whose parent is a plain section is refused', () => {
    expect(() => insertCrop(withPlainSection(), cropView({ parent: 'sec1' }))).toThrow(/局部剖視圖|local section/);
  });

  it('a crop whose parent does not exist is refused', () => {
    expect(() => insertCrop(cut(), cropView({ parent: 'nope' }))).toThrow(/母視圖|parent/);
  });

  it('a crop with no outline is refused', () => {
    expect(() => insertCrop(cut(), cropView({ outline: undefined as never }))).toThrow(/輪廓|outline/);
  });

  it('a crop with an unclosed polygon is refused', () => {
    expect(() => insertCrop(cut(), cropView({ outline: { kind: 'polygon', points: [[0, 0], [20, 0], [20, 20]] } }))).toThrow(/輪廓|outline/);
  });

  it('a crop with a non-positive circle radius is refused', () => {
    expect(() => insertCrop(cut(), cropView({ outline: { kind: 'circle', centre: [10, 10], radius: 0 } }))).toThrow(/輪廓|outline/);
  });

  it('setView refuses a field that does not belong to crop', () => {
    const d = insertCrop(cut());
    expect(() => applyDrawingCommand(d, { type: 'setView', viewId: 'crop1', patch: { line: [[0, 0], [10, 10]] } })).toThrow(/不屬於|does not belong/);
  });

  it('a crop is saved and read back as it is', () => {
    const back = parseDrawing(serializeDrawing(insertCrop(cut())));
    expect(back.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
    const v = page(back).views.find((x) => x.id === 'crop1')! as CropDrawingView;
    expect(v.kind).toBe('crop');
    expect(v.parent).toBe('localsec1');
    expect(v.outline).toEqual({ kind: 'rectangle', p0: [0, 0], p1: [20, 20] });
  });

  it('a version-22 drawing (before crops) is read as 25, keeping what it had', () => {
    const read = parseDrawing(JSON.stringify(olderDrawingFile(cut(), 22)));
    expect(read.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
    expect(page(read).views.find((x) => x.id === 'localsec1')).toBeDefined();
  });

  it("the crop shows its parent's lines clipped to the outline, and is as big as the outline not the parent", () => {
    const d = insertCrop(cut());
    const resolved = resolveLines(d, new Map([['localsec1', LINES]]));
    const r = resolved.get('crop1')!;
    // the box is the outline's own, not the parent's 40-wide one
    expect(r.box).toEqual({ min: [0, 0], max: [20, 20] });
    // the parent's line at y = 5 runs 0..40 and is cut where it leaves the outline, at x = 20
    expect(r.visible).toHaveLength(1);
    const [x0, y0, x1, y1] = r.visible[0]!;
    expect(x0).toBeCloseTo(0, 6);
    expect(y0).toBeCloseTo(5, 6);
    expect(x1).toBeCloseTo(20, 6);
    expect(y1).toBeCloseTo(5, 6);
    // and the parent's cut faces are carried over, so that the crop is hatched
    expect(r.cut).toHaveLength(2);
  });

  it('the crop is placed at its parent scale', () => {
    const d = insertCrop(cut([1, 2]));
    const v = page(d).views.find((x) => x.id === 'crop1')!;
    expect(scaleOf(d, v)).toEqual([1, 2]);
    const own = layoutViews(d, new Map([['localsec1', LINES]])).get('crop1')!;
    const parent = layoutViews(d, new Map([['localsec1', LINES]])).get('localsec1')!;
    // a 20 × 20 outline at 1:2 is a 10 × 10 square on the sheet, smaller than the 40-wide parent
    expect(own.w).toBeCloseTo(10, 6);
    expect(own.h).toBeCloseTo(10, 6);
    expect(own.w).toBeLessThan(parent.w);
  });

  it('is scaled with its parent: dragging its corner names the parent, not the sheet (as a section does)', () => {
    // the local section it crops has a scale of its own, so scaling the crop must reach that view and not the whole sheet (ADR 0152 defect: scaleOf followed the
    // parent but scaleTarget named the sheet, so dragging a crop's corner rescaled the sheet while the crop — drawn at its parent's scale — did not move)
    const d = insertCrop(cut([1, 2]));
    expect(scaleTarget(d, page(d).views.find((x) => x.id === 'crop1')!)).toEqual({ view: 'localsec1' });
    // the control: with no scale of its own anywhere up the chain, the sheet is what a scale change names — as before
    const plain = insertCrop(cut());
    expect(scaleTarget(plain, page(plain).views.find((x) => x.id === 'crop1')!)).toEqual({ sheet: true });
  });

  it('a crop is not shaded: no image is carried, and the same lines on a shaded view do give one', () => {
    const d = insertCrop(cut());
    const placed = layoutViews(d, new Map([['localsec1', LINES]])).get('crop1')!;
    // nothing the parent shaded is carried onto the crop
    expect(resolveLines(d, new Map([['localsec1', { ...LINES, shade: onePixel() }]])).get('crop1')!.shade).toBeUndefined();
    // and even handed a picture the crop draws none, where a shaded view of the same lines draws one
    const shaded: ViewLines = { ...LINES, shade: onePixel() };
    expect(viewImage(cropView({ display: 'shaded' }), shaded, placed)).toBeNull();
    const control: DrawingView = { id: 'sec1', kind: 'section', name: 'A-A', parent: 'view1', line: [[0, 0], [40, 0]], label: 'A', display: 'shaded' };
    expect(viewImage(control, shaded, placed)).not.toBeNull();
  });

  it('the faces the parent cut are hatched, and the outline is drawn on the parent', () => {
    const d = insertCrop(cut());
    const lines = new Map([['localsec1', LINES]]);
    const own = layoutViews(d, lines).get('crop1')!;
    const clipped: ViewLines = { visible: [[0, 5, 20, 5]], hidden: [], box: { min: [0, 0], max: [20, 20] } };
    // the cut faces add hatching on top of the same lines (a face is a closed outline, as the cut hands it over)
    const face = [0, 5, 20, 5, 20, 15, 0, 15, 0, 5];
    expect(viewItems(cropView(), { ...clipped, cut: [face] }, own).length).toBeGreaterThan(viewItems(cropView(), clipped, own).length);
    // the outline of the crop is drawn on the parent: a thin closed polyline, and the crop is what adds it (the sheet draws thin closed lines of its own)
    const closedThin = (items: readonly { kind: string; style?: string; closed?: boolean }[]) => items.filter((i) => i.kind === 'polyline' && i.style === 'thin' && i.closed).length;
    expect(closedThin(buildScene(d, lines).scene.items)).toBe(closedThin(buildScene(cut(), lines).scene.items) + 1);
  });
});
