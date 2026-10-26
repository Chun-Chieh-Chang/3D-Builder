/**
 * 5-1 (docs/phase5-plan.md): the sheet, the layout of views (first and third angle), the scale a drawing is made at, and the scene the outputs are written from.
 * The positions are worked out by hand.
 */
import { describe, expect, it } from 'vitest';
import { getLocale, type Locale } from '@3db/i18n';
import { applyDrawingCommand, createEmptyDrawing, type DrawingDoc, type DrawingPage, type DrawingView, type ModelDrawingView } from '@3db/model';
import { buildScene, layoutViews, sheetMetrics, STANDARD_SCALES, titleCells, toSvg, VIEW_GAP, type SceneText, type ViewLines } from '@3db/drawing';

const view = (id: string, direction: ModelDrawingView['direction'], extra: Partial<ModelDrawingView> = {}): DrawingView => ({ id, name: id, source: 'x.3dbx', direction, ...extra });
const doc = (views: DrawingView[], sheet: Partial<DrawingPage['sheet']> = {}): DrawingDoc => applyDrawingCommand(applyDrawingCommand(createEmptyDrawing(), { type: 'setSheet', sheet: { projection: 'first', ...sheet } }), { type: 'insertViews', views });
const box = (w: number, h: number, x = 0, y = 0): ViewLines => ({ visible: [[x, y, x + w, y + h]], hidden: [], box: { min: [x, y], max: [x + w, y + h] } });

describe('the sheet (ISO 5457, ISO 7200)', () => {
  it('sizes in mm, landscape and portrait', () => {
    expect([sheetMetrics({ size: 'A4', orientation: 'landscape' }), sheetMetrics({ size: 'A3', orientation: 'portrait' })].map((m) => [m.width, m.height])).toEqual([[297, 210], [297, 420]]);
    expect(sheetMetrics({ size: 'A1', orientation: 'landscape' })).toMatchObject({ width: 841, height: 594 });
  });

  it('A3 landscape: the frame 20 from the left and 10 from the others, the title block 180 x 48 at the lower right, the area above it', () => {
    const m = sheetMetrics({ size: 'A3', orientation: 'landscape' });
    expect(m.frame).toEqual({ x: 20, y: 10, w: 390, h: 277 });
    expect(m.titleBlock).toEqual({ x: 230, y: 10, w: 180, h: 48 });
    expect(m.area).toEqual({ x: 28, y: 66, w: 374, h: 213 });
    expect(sheetMetrics({ size: 'A2', orientation: 'landscape' }).frame).toEqual({ x: 20, y: 20, w: 554, h: 380 }); // 20 mm all round on the larger sheets
  });

  it('the title block cells tile the block: four rows, no overlaps, every cell inside it', () => {
    const cells = titleCells();
    expect(cells).toHaveLength(11); // 1 + 3 + 4 + 3
    expect(cells.reduce((a, c) => a + c.w * c.h, 0)).toBeCloseTo(180 * 48, 9);
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(180 + 1e-9);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y + c.h).toBeLessThanOrEqual(48 + 1e-9);
    }
  });
});

describe('laying out the views (C16.2)', () => {
  // front 100 x 60, top 100 x 40, right 40 x 60, gap 25; the area of an A3 sheet is centred on (215, 172.5)
  const lines = new Map<string, ViewLines>([['f', box(100, 60)], ['t', box(100, 40)], ['r', box(40, 60)]]);
  const views = [view('f', 'front'), view('t', 'top'), view('r', 'right')];

  it('first angle: the top view below the front view, the right view to its left; the group centred in the area', () => {
    const p = layoutViews(doc(views), lines);
    expect(VIEW_GAP).toBe(25);
    // the group is from x = -115 to 50 and y = -95 to 30 relative to the front view's middle
    expect(p.get('f')!.at).toEqual([expect.closeTo(247.5, 9), expect.closeTo(205, 9)]);
    expect(p.get('t')!.at).toEqual([expect.closeTo(247.5, 9), expect.closeTo(130, 9)]); // 30 + 25 + 20 below
    expect(p.get('r')!.at).toEqual([expect.closeTo(152.5, 9), expect.closeTo(205, 9)]); // 50 + 25 + 20 to the left
  });

  it('default third angle: the top view above, the right view to the right', () => {
    const p = layoutViews(applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views }), lines);
    const f = p.get('f')!.at;
    expect([p.get('t')!.at[0] - f[0], p.get('t')!.at[1] - f[1]]).toEqual([expect.closeTo(0, 9), expect.closeTo(75, 9)]);
    expect([p.get('r')!.at[0] - f[0], p.get('r')!.at[1] - f[1]]).toEqual([expect.closeTo(95, 9), expect.closeTo(0, 9)]);
  });

  it('views are measured at their scale: at 1:2 everything is half the size, the gaps are not', () => {
    const p = layoutViews(doc(views, { scale: [1, 2] }), lines);
    expect(p.get('f')).toMatchObject({ scale: 0.5, w: 50, h: 30 });
    const f = p.get('f')!.at;
    expect(f[1] - p.get('t')!.at[1]).toBeCloseTo(15 + 25 + 10, 9); // half the front height, the gap, half the top height
  });

  it('a view with a position of its own stays there, and the others are laid out without it', () => {
    const p = layoutViews(doc([view('f', 'front'), view('t', 'top', { at: [300, 50] }), view('r', 'right')]), lines);
    expect(p.get('t')!.at).toEqual([300, 50]);
    const f = p.get('f')!.at;
    expect(f[0] - p.get('r')!.at[0]).toBeCloseTo(50 + 25 + 20, 9);
  });

  it('the isometric view goes beside the others, and the back view past the left view', () => {
    const p = layoutViews(doc([view('f', 'front'), view('i', 'isometric')]), new Map([['f', box(100, 60)], ['i', box(70, 70)]]));
    expect(p.get('i')!.at[0] - p.get('f')!.at[0]).toBeCloseTo(50 + 25 + 35, 9);
    const q = layoutViews(doc([view('f', 'front'), view('l', 'left'), view('b', 'back')]), new Map([['f', box(100, 60)], ['l', box(40, 60)], ['b', box(100, 60)]]));
    expect(q.get('l')!.at[0] - q.get('f')!.at[0]).toBeCloseTo(95, 9); // first angle: the left view is to the right
    expect(q.get('b')!.at[0] - q.get('l')!.at[0]).toBeCloseTo(20 + 25 + 50, 9);
  });

  it('a view that is not there (its model could not be read) takes no room', () => {
    const p = layoutViews(doc(views), new Map([['f', box(100, 60)], ['t', null], ['r', box(40, 60)]]));
    expect(p.get('t')).toMatchObject({ w: 0, h: 0 });
  });
});

describe('the scale (ISO 5455)', () => {
  it('the standard scales are the ISO 5455 list, 1:5 among them', () => {
    expect(STANDARD_SCALES.map((s) => `${s[0]}:${s[1]}`)).toContain('1:5');
  });
});

describe('the scene and the SVG written from it', () => {
  const d = applyDrawingCommand(doc([view('f', 'front'), view('t', 'top')]), { type: 'setTitle', field: 'drawingName', value: '基板 <A&B>' });
  const lines = new Map<string, ViewLines>([['f', { visible: [[0, 0, 10, 0, 10, 5]], hidden: [[2, 2, 8, 2]], box: { min: [0, 0], max: [10, 5] } }], ['t', box(10, 4)]]);

  it('has the frame, the title block with what was written in it, and the lines of each view moved to where the view is', () => {
    const { scene, placed } = buildScene(d, lines);
    expect([scene.width, scene.height]).toEqual([420, 297]);
    const texts = scene.items.flatMap((i) => (i.kind === 'text' ? [i.text] : []));
    expect(texts).toEqual(expect.arrayContaining(['基板 <A&B>', '1:1', 'A3']));
    // the front view's centre in view coordinates is (5, 2.5): its line (0, 0)-(10, 0) goes to the sheet position of the view less 5 and 2.5
    const f = placed.get('f')!;
    const visible = scene.items.find((i) => i.kind === 'polyline' && i.style === 'visible')!;
    expect(visible).toMatchObject({ kind: 'polyline', points: [expect.closeTo(f.at[0] - 5, 9), expect.closeTo(f.at[1] - 2.5, 9), expect.closeTo(f.at[0] + 5, 9), expect.closeTo(f.at[1] - 2.5, 9), expect.closeTo(f.at[0] + 5, 9), expect.closeTo(f.at[1] + 2.5, 9)] });
    expect(scene.items.filter((i) => i.kind === 'polyline' && i.style === 'hidden')).toHaveLength(1);
  });

  it('names each view under it, so a reader can tell which is which; the scale is in the title block', () => {
    const { scene, placed } = buildScene(d, lines);
    const names = scene.items.filter((i): i is SceneText => i.kind === 'text' && (i.text === 'f' || i.text === 't'));
    expect(names.map((i) => i.text)).toEqual(['f', 't']);
    const f = placed.get('f')!;
    expect(names[0]).toMatchObject({ at: [f.at[0], f.at[1] - f.h / 2 - 8], height: 5, anchor: 'center' });
  });

  it('writes the sheet in the sheet\'s own language, not the reader\'s, and leaves the interface alone (ADR 0128)', () => {
    const texts = (language: Locale | null) => {
      const doc = applyDrawingCommand(d, { type: 'setSheet', sheet: { language } });
      return buildScene(doc, lines).scene.items.flatMap((i) => (i.kind === 'text' ? [i.text] : []));
    };
    // the title block's own labels are texts of the sheet, so they show it without needing a dimension to read
    expect(texts('zh-TW')).toContain('比例');
    expect(texts('en')).toContain('Scale');
    // `null` is 「follow the interface」, which is what a drawing that says nothing does
    const before = getLocale();
    expect(texts(null)).toContain(before === 'en' ? 'Scale' : '比例');
    // building a sheet in another language must not change what the reader sees
    texts('en');
    expect(getLocale()).toBe(before);
  });

  it('draws no hidden lines for a view that has them off', () => {
    const off = applyDrawingCommand(d, { type: 'setView', viewId: 'f', patch: { display: 'hiddenRemoved' } });
    expect(buildScene(off, lines).scene.items.filter((i) => i.kind === 'polyline' && i.style === 'hidden')).toHaveLength(0);
  });

  it('is written as SVG of the sheet size in mm, the y turned over, the text escaped, a line for each polyline', () => {
    const { scene } = buildScene(d, lines);
    const svg = toSvg(scene);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" viewBox="0 0 420 297">')).toBe(true);
    expect(svg).toContain('基板 &lt;A&amp;B&gt;');
    const lineCount = scene.items.filter((i) => i.kind === 'polyline').length;
    expect((svg.match(/<polyline|<polygon/g) ?? []).length).toBe(lineCount);
    expect(svg).toContain('stroke-dasharray="3 1"'); // the hidden line
    expect(svg).toContain('20,287'); // the frame's lower left corner (20, 10) is at (20, 297 - 10) in SVG
    expect((svg.match(/<svg/g) ?? []).length).toBe(1);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });
});
