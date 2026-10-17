/**
 * B2.7 (2026-10-19): the auxiliary view — the model seen square to a fold line drawn on a view (補助線法: the fold line is the reference, so no named edge of the
 * model is needed), so that a slanted face of the part is shown true size. It is a kind of view of its own (`auxiliary`), not a placement trick, and three things
 * are locked here rather than taken on trust:
 *   1. Its frame comes from the fold line: it looks square to that line, in the plane of its parent — the same frame a section looks along, without the cut. That
 *      is checked against the fold line's own direction in the model (dot products over a fuzz of angles), not against a table of ready-made numbers.
 *   2. Nothing is cut: `sectionCut` refuses it, so no plane cuts the part (no cut faces are handed over to be hatched).
 *   3. It is placed on the fold line's side of its parent and in line with it, as a section is; and it is named by its letter the way ISO 128-30 asks — the fold
 *      line drawn across the parent with an arrow and the letter at each end, and 「A–A」 under the view itself.
 */
import { describe, expect, it } from 'vitest';
import {
  applyDrawingCommand,
  axesOf,
  createEmptyDrawing,
  DRAWING_SCHEMA_VERSION,
  parseDrawing,
  rightOf,
  sectionArrow,
  sectionCut,
  sectionSide,
  serializeDrawing,
  sheetUp,
  type AuxiliaryDrawingView,
  type DrawingDoc,
  type ViewAxes, page } from '@3db/model';
import { olderDrawingFile } from '../support/drawingVersion';
import { buildScene, layoutViews, scaleOf, slideAxis, type ViewLines } from '@3db/drawing';

type P = [number, number];
type V3 = [number, number, number];

/** A front view of a plate: the parent an auxiliary view is turned about. */
const modelView = (): DrawingDoc =>
  applyDrawingCommand(createEmptyDrawing(), {
    type: 'insertViews',
    views: [{ id: 'view1', kind: 'model', name: 'Front', source: 'part.3dbx', direction: 'front' }],
  });

const auxiliaryView = (overrides: Partial<AuxiliaryDrawingView> = {}): AuxiliaryDrawingView => ({
  id: 'aux1',
  kind: 'auxiliary',
  name: 'Auxiliary A-A',
  parent: 'view1',
  line: [[0, -10], [0, 10]],
  label: 'A',
  ...overrides,
});

const insert = (doc: DrawingDoc, v: AuxiliaryDrawingView = auxiliaryView()) => applyDrawingCommand(doc, { type: 'insertViews', views: [v] });

/** The lines of the parent view: a 40 × 20 plate. */
const LINES: ViewLines = { visible: [[0, 0, 40, 0], [0, 20, 40, 20]], hidden: [], box: { min: [0, 0], max: [40, 20] } };

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const n = Math.hypot(...a);
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** The fold line as a direction in the model, from the parent's own frame (view coordinates → the model's axes). */
const foldDirection = (parent: ViewAxes, line: readonly [P, P]): V3 => {
  const r = rightOf(parent);
  const u = sheetUp(parent);
  const dx = line[1][0] - line[0][0];
  const dy = line[1][1] - line[0][1];
  return norm([dx * r[0] + dy * u[0], dx * r[1] + dy * u[1], dx * r[2] + dy * u[2]]);
};

/** A deterministic generator, so that the fuzz below is the same every run. */
const makeRandom = (seed: number): (() => number) => {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
};

describe('the auxiliary view (B2.7)', () => {
  it('the drawing schema is 25', () => {
    expect(DRAWING_SCHEMA_VERSION).toBe(25);
  });

  it('an auxiliary view inserts and keeps its parent, fold line and letter', () => {
    const v = page(insert(modelView())).views.find((x) => x.id === 'aux1')! as AuxiliaryDrawingView;
    expect(v.kind).toBe('auxiliary');
    expect(v.parent).toBe('view1');
    expect(v.line).toEqual([[0, -10], [0, 10]]);
    expect(v.label).toBe('A');
  });

  it('flip is kept, as a section keeps it', () => {
    const v = page(insert(modelView(), auxiliaryView({ flip: true }))).views.find((x) => x.id === 'aux1')! as AuxiliaryDrawingView;
    expect(v.flip).toBe(true);
  });

  it('looks square to the fold line and stays in the plane of its parent (a fuzz of angles)', () => {
    const doc = modelView();
    const parent = axesOf(page(doc).views, page(doc).sheet.projection, page(doc).views[0]!)!;
    const random = makeRandom(20261019);
    let slanted = 0;
    for (let i = 0; i < 200; i++) {
      const line: [P, P] = [[0, 0], [Math.round((random() * 40 - 20) * 100) / 100, Math.round((random() * 40 - 20) * 100) / 100]];
      if (Math.hypot(line[1][0], line[1][1]) < 1e-3) continue;
      const withIt = applyDrawingCommand(doc, { type: 'insertViews', views: [auxiliaryView({ id: `f${i}`, line, label: 'B' })] });
      const axes = axesOf(page(withIt).views, page(withIt).sheet.projection, page(withIt).views.find((v) => v.id === `f${i}`)!);
      expect(axes).not.toBeNull();
      const a = axes!;
      // the frame is orthonormal, so the view is a true projection and not a squashed one
      expect(Math.hypot(...a.dir)).toBeCloseTo(1, 9);
      expect(Math.hypot(...a.up)).toBeCloseTo(1, 9);
      expect(dot(a.dir, a.up)).toBeCloseTo(0, 9);
      // it looks square to the fold line — the whole point of an auxiliary view
      expect(Math.abs(dot(a.dir, foldDirection(parent, line)))).toBeLessThan(1e-9);
      // and within the plane of its parent, so the parent's own depth is what the view shows
      expect(Math.abs(dot(a.dir, parent.dir))).toBeLessThan(1e-9);
      if (Math.abs(line[1][0]) > 1e-6 && Math.abs(line[1][1]) > 1e-6) slanted++;
    }
    // the fuzz really did walk off the axes (not a run of verticals only)
    expect(slanted).toBeGreaterThan(150);
  });

  it('a vertical fold line on a front view turns the part round to the other side (a horizontal one over the top)', () => {
    const doc = modelView();
    const vertical = axesOf(page(applyDrawingCommand(doc, { type: 'insertViews', views: [auxiliaryView()] })).views, page(doc).sheet.projection, auxiliaryView())!;
    // the arrows of a vertical line point along the parent's sheet x, so the view looks along it: the part's own left is what is seen
    expect(vertical.dir).toEqual([1, 0, 0]);
    expect(vertical.up).toEqual([0, 1, 0]);
    const flipped = axesOf(page(applyDrawingCommand(doc, { type: 'insertViews', views: [auxiliaryView({ flip: true })] })).views, page(doc).sheet.projection, auxiliaryView({ flip: true }))!;
    expect(flipped.dir).toEqual([-1, 0, 0]);
    // a horizontal fold line is square to the model's up instead: a view over the top (or under the bottom), not one of the depth
    const horizontal = axesOf(page(applyDrawingCommand(doc, { type: 'insertViews', views: [auxiliaryView({ line: [[-10, 0], [10, 0]] })] })).views, page(doc).sheet.projection, auxiliaryView({ line: [[-10, 0], [10, 0]] }))!;
    expect(Math.abs(horizontal.dir[1])).toBeCloseTo(1, 9);
    expect(horizontal.dir[2]).toBe(0);
  });

  it('nothing is cut: a section plane is refused for it', () => {
    const doc = insert(modelView());
    const parent = axesOf(page(doc).views, page(doc).sheet.projection, page(doc).views[0]!)!;
    const v = page(doc).views.find((x) => x.id === 'aux1')!;
    expect(() => sectionCut(parent, v)).toThrow(/不屬於|does not belong/);
  });

  it('its fold line is one straight line: a bend is refused', () => {
    expect(() => insert(modelView(), auxiliaryView({ line: [[0, -10], [0, 0], [10, 0]] as unknown as [P, P] }))).toThrow(/折線|fold line/);
  });

  it('a fold line of no length is refused', () => {
    expect(() => insert(modelView(), auxiliaryView({ line: [[5, 5], [5, 5]] }))).toThrow(/剖面線|section line|折線/);
  });

  it('a fold line that is not numbers is refused', () => {
    expect(() => insert(modelView(), auxiliaryView({ line: [[0, 0], [Number.NaN, 10]] }))).toThrow(/剖面線|section line|折線/);
  });

  it('an empty letter is refused', () => {
    expect(() => insert(modelView(), auxiliaryView({ label: '  ' }))).toThrow(/字母|letter/);
  });

  it('a parent that does not exist is refused', () => {
    expect(() => insert(modelView(), auxiliaryView({ parent: 'nope' }))).toThrow(/母視圖|parent/);
  });

  it('setView takes its line, flip and letter, and refuses what it is not', () => {
    const d = insert(modelView());
    const moved = applyDrawingCommand(d, { type: 'setView', viewId: 'aux1', patch: { line: [[0, -5], [0, 5]], flip: true, label: 'B' } });
    const v = page(moved).views.find((x) => x.id === 'aux1')! as AuxiliaryDrawingView;
    expect(v.line).toEqual([[0, -5], [0, 5]]);
    expect(v.flip).toBe(true);
    expect(v.label).toBe('B');
    expect(() => applyDrawingCommand(d, { type: 'setView', viewId: 'aux1', patch: { outline: { kind: 'circle', centre: [0, 0], radius: 5 } } })).toThrow(/不屬於|does not belong/);
    expect(() => applyDrawingCommand(d, { type: 'setView', viewId: 'aux1', patch: { side: 'right' } })).toThrow(/不屬於|does not belong/);
  });

  it('a flip on a kind that is not a section or an auxiliary view is still refused', () => {
    const d = applyDrawingCommand(modelView(), {
      type: 'insertViews',
      views: [{ id: 'proj1', kind: 'projected', name: 'Projected', parent: 'view1', side: 'right' }],
    });
    expect(() => applyDrawingCommand(d, { type: 'setView', viewId: 'proj1', patch: { flip: true } })).toThrow(/不屬於|does not belong/);
  });

  it('an auxiliary view is saved and read back as it is', () => {
    const back = parseDrawing(serializeDrawing(insert(modelView())));
    expect(back.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
    const v = page(back).views.find((x) => x.id === 'aux1')! as AuxiliaryDrawingView;
    expect(v.kind).toBe('auxiliary');
    expect(v.parent).toBe('view1');
    expect(v.line).toEqual([[0, -10], [0, 10]]);
    expect(v.label).toBe('A');
  });

  it('a version-23 drawing (the last before auxiliary views) is read as 25, keeping what it had', () => {
    const read = parseDrawing(JSON.stringify(olderDrawingFile(insert(modelView()), 23)));
    expect(read.schemaVersion).toBe(25);
    expect(page(read).views.find((x) => x.id === 'aux1')).toBeDefined();
  });

  it('is placed on the fold line side of its parent and in line with it, as a section is', () => {
    const d = insert(modelView());
    const placed = layoutViews(
      d,
      new Map([
        ['view1', LINES],
        ['aux1', LINES],
      ]),
    );
    const own = placed.get('aux1')!;
    const parent = placed.get('view1')!;
    const side = sectionSide(sectionArrow(auxiliaryView()), page(d).sheet.projection);
    // a vertical fold line puts it left or right, never above or below, and level with the parent (in line with it)
    expect(side === 'left' || side === 'right').toBe(true);
    expect(Math.abs(own.at[1] - parent.at[1])).toBeLessThan(1e-6);
    expect(side === 'right' ? own.at[0] : -own.at[0]).toBeGreaterThan(parent.w / 2);
    expect(slideAxis(d, auxiliaryView())).toBe(0);
    // and a horizontal fold line puts it above or below instead
    const flat = auxiliaryView({ line: [[-10, 0], [10, 0]] });
    expect(slideAxis(d, flat)).toBe(1);
  });

  it("is drawn at its parent's scale, as a section is (a control: a sheet-scale view stays on the sheet's)", () => {
    // a parent with a scale of its own — the front view at 1:2 — so that inheriting and not inheriting can be told apart
    const scaled = applyDrawingCommand(createEmptyDrawing(), {
      type: 'insertViews',
      views: [{ id: 'view1', kind: 'model', name: 'Front', source: 'part.3dbx', direction: 'front', scale: [1, 2] }],
    });
    const d = insert(scaled);
    const aux = page(d).views.find((x) => x.id === 'aux1')!;
    // the auxiliary view is the parent turned, so it is the parent's 1:2, not the sheet's 1:1
    expect(scaleOf(d, aux)).toEqual([1, 2]);
    expect(scaleOf(d, page(d).views[0]!)).toEqual([1, 2]);
    // the control: an auxiliary view whose parent has no scale of its own takes the sheet's, exactly as before
    const plain = insert(modelView());
    expect(scaleOf(plain, page(plain).views.find((x) => x.id === 'aux1')!)).toEqual(page(plain).sheet.scale);
  });

  it('the fold line is drawn across the parent with its arrows and letters, and the view is titled by its letter', () => {
    const d = insert(modelView());
    const lines = new Map([
      ['view1', LINES],
      ['aux1', LINES],
    ]);
    const withIt = buildScene(d, lines).scene.items;
    const without = buildScene(modelView(), new Map([['view1', LINES]])).scene.items;
    const centerLines = (items: readonly { kind: string; style?: string }[]) => items.filter((i) => i.kind === 'polyline' && i.style === 'center').length;
    // the fold line itself (a centre-styled line, as a section's cutting line is)
    expect(centerLines(withIt)).toBe(centerLines(without) + 1);
    const texts = withIt.filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text);
    // the letter at each end of the fold line, and 「A–A」 under the view
    expect(texts.filter((x) => x === 'A')).toHaveLength(2);
    expect(texts).toContain('A-A');
    // the view's own name is not written under it: its letter is what names it (ISO 128-30)
    expect(texts).not.toContain('Auxiliary A-A');
  });
});
