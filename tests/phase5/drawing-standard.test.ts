/**
 * ADR 0260: the drafting standard of a sheet (CNS 3 or ISO) and its profile, the one place every value of a standard is written. Each width, dash and frame is
 * measured on what is drawn and written (the scene, the SVG, the PDF's content stream, the DXF's layers), not taken from the table it came from.
 */
import { describe, expect, it } from 'vitest';
import {
  applyDrawingCommand,
  baseDimStyle,
  createEmptyDrawing,
  DEFAULT_DRAWING_STANDARD,
  DRAWING_PROFILES,
  DRAWING_SCHEMA_VERSION,
  DRAWING_STANDARDS,
  parseDrawing,
  serializeDrawing,
  SHEET_SIZES,
  standardOf,
  type DrawingDoc,
  type DrawingStandard,
  type DrawingView,
  type SheetSize,
} from '@3db/model';
import { buildScene, LINE_STYLES, lineStylesFor, sheetMetrics, toDxf, toPdf, toSvg, type Scene, type ViewLines } from '@3db/drawing';
import { DEFAULT_OPTIONS, parseOptions } from '../../apps/web/src/options';

/** The table the standards are drawn to, written out by hand from ADR 0260 (so a change to the profile is a change to this test, said out loud). */
const EXPECTED: Record<DrawingStandard, Record<SheetSize, { thick: number; medium: number; thin: number; left: number; other: number }>> = {
  ISO: {
    A4: { thick: 0.5, medium: 0.25, thin: 0.25, left: 20, other: 10 },
    A3: { thick: 0.5, medium: 0.25, thin: 0.25, left: 20, other: 10 },
    A2: { thick: 0.5, medium: 0.25, thin: 0.25, left: 20, other: 20 },
    A1: { thick: 0.5, medium: 0.25, thin: 0.25, left: 20, other: 20 },
    A0: { thick: 0.5, medium: 0.25, thin: 0.25, left: 20, other: 20 },
  },
  CNS: {
    A4: { thick: 0.5, medium: 0.35, thin: 0.18, left: 25, other: 10 },
    A3: { thick: 0.5, medium: 0.35, thin: 0.18, left: 25, other: 10 },
    A2: { thick: 0.5, medium: 0.35, thin: 0.18, left: 25, other: 15 },
    A1: { thick: 0.7, medium: 0.5, thin: 0.25, left: 25, other: 15 },
    A0: { thick: 0.7, medium: 0.5, thin: 0.25, left: 25, other: 15 },
  },
};
const LANDSCAPE: Record<SheetSize, [number, number]> = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] };
const CASES = DRAWING_STANDARDS.flatMap((standard) => SHEET_SIZES.map((size) => [standard, size] as const));

/** A drawing of one front view of a 40 × 20 box, with one visible, one hidden line and a centre mark, on `size` drawn to `standard`. */
function drawing(standard: DrawingStandard | undefined, size: SheetSize): { doc: DrawingDoc; scene: Scene } {
  let doc = createEmptyDrawing(standard ?? 'ISO');
  if (standard === undefined) delete (doc.pages[0]!.sheet as { standard?: string }).standard;
  doc = applyDrawingCommand(doc, { type: 'setSheet', sheet: { size } });
  const view: DrawingView = { id: 'f', name: 'f', source: 'x.3dbx', direction: 'front' } as DrawingView;
  doc = applyDrawingCommand(doc, { type: 'insertViews', views: [view] });
  const lines = new Map<string, ViewLines>([['f', { visible: [[0, 0, 40, 0, 40, 20]], hidden: [[0, 10, 40, 10]], box: { min: [0, 0], max: [40, 20] } }]]);
  return { doc, scene: buildScene(doc, lines, new Map(), new Map(), new Map()).scene };
}

describe('1-1 the line widths of each standard on each sheet', () => {
  it.each(CASES)('%s %s: thick outlines, medium hidden lines, thin the rest, the frame 0.7', (standard, size) => {
    const e = EXPECTED[standard][size];
    const st = lineStylesFor({ size, standard });
    expect([st.visible.width, st.hidden.width, st.center.width, st.thin.width, st.dimension.width, st.frame.width]).toEqual([e.thick, e.medium, e.thin, e.thin, e.thin, 0.7]);
    // what the SVG writes for the view's lines, read back from the SVG text
    const { scene } = drawing(standard, size);
    const svg = toSvg(scene);
    const strokes = (dash: string | null) => new Set([...svg.matchAll(/<(?:polyline|polygon) [^>]*stroke-width="([\d.]+)"([^>]*)>/g)].filter((m) => (dash === null ? !m[2]!.includes('dasharray') : m[2]!.includes(`stroke-dasharray="${dash}"`))).map((m) => Number(m[1])));
    expect(strokes(st.hidden.dash!.join(' '))).toContain(e.medium);
    expect(strokes(null)).toContain(e.thick);
    expect(strokes(null)).toContain(0.7);
  });
});

describe('1-2 the dashes', () => {
  it('ISO as always: hidden 3 / 1, centre 12, 2, 2, 2', () => {
    expect(lineStylesFor({ size: 'A3', standard: 'ISO' }).hidden.dash).toEqual([3, 1]);
    expect(lineStylesFor({ size: 'A3', standard: 'ISO' }).center.dash).toEqual([12, 2, 2, 2]);
  });
  it.each(SHEET_SIZES)('CNS on %s: hidden 3 / 1 drawn medium, centre a 20 mm dash, a 1 mm gap, a dot, a 1 mm gap', (size) => {
    const st = lineStylesFor({ size, standard: 'CNS' });
    expect(st.hidden.dash).toEqual([3, 1]);
    expect(st.center.dash).toEqual([20, 1, 0.5, 1]);
    expect(st.center.linetype).toBe('CENTER_CNS');
  });
});

describe('1-3 the frame', () => {
  it.each(CASES)('%s %s: the frame where the standard puts it, the area inside it', (standard, size) => {
    const e = EXPECTED[standard][size];
    const [w, h] = LANDSCAPE[size];
    const m = sheetMetrics({ size, orientation: 'landscape', standard });
    expect(m.frame).toEqual({ x: e.left, y: e.other, w: w - e.left - e.other, h: h - 2 * e.other });
    expect(m.area.x).toBeCloseTo(e.left + 8, 9);
    expect(m.area.x + m.area.w).toBeCloseTo(w - e.other - 8, 9);
    // the frame is drawn where it is computed
    const { scene } = drawing(standard, size);
    const frame = scene.items.find((i) => i.kind === 'polyline' && i.style === 'frame' && i.points[0] === e.left);
    expect(frame && frame.kind === 'polyline' ? frame.points.slice(0, 4) : null).toEqual([e.left, e.other, w - e.other, e.other]);
  });
});

describe('a sheet that names no standard (made before v39) is ISO, drawn exactly as before', () => {
  it('ISO: the same scene as an explicit ISO, with no lines of its own and no dimension style', () => {
    for (const size of SHEET_SIZES) {
      const legacy = drawing(undefined, size).scene;
      expect(standardOf(drawing(undefined, size).doc.pages[0]!.sheet)).toBe('ISO');
      expect(legacy).toEqual(drawing('ISO', size).scene);
      expect(legacy.lines).toBeUndefined();
      expect(legacy.dimStyle).toBeUndefined();
    }
    // ISO's line styles are the ones this program has always drawn
    expect(LINE_STYLES).toEqual({
      visible: { width: 0.5, dash: null, layer: 'VISIBLE', linetype: 'CONTINUOUS' },
      hidden: { width: 0.25, dash: [3, 1], layer: 'HIDDEN', linetype: 'DASHED' },
      center: { width: 0.25, dash: [12, 2, 2, 2], layer: 'CENTER', linetype: 'CENTER' },
      thin: { width: 0.25, dash: null, layer: 'THIN', linetype: 'CONTINUOUS' },
      frame: { width: 0.7, dash: null, layer: 'FRAME', linetype: 'CONTINUOUS' },
      dimension: { width: 0.25, dash: null, layer: 'DIMENSION', linetype: 'CONTINUOUS' },
    });
  });
});

describe('1-5 a new drawing is made to the system default, written in one place', () => {
  it('the default is CNS, and an empty drawing, the web options and the MCP option all start from it', () => {
    expect(DEFAULT_DRAWING_STANDARD).toBe('CNS');
    expect(standardOf(createEmptyDrawing().pages[0]!.sheet)).toBe(DEFAULT_DRAWING_STANDARD);
    expect(createEmptyDrawing('ISO').pages[0]!.sheet.standard).toBe('ISO');
    expect(DEFAULT_OPTIONS.drawingStandard).toBe(DEFAULT_DRAWING_STANDARD);
    expect(parseOptions({}).drawingStandard).toBe(DEFAULT_DRAWING_STANDARD);
    expect(parseOptions({ drawingStandard: 'ISO' }).drawingStandard).toBe('ISO');
    expect(parseOptions({ drawingStandard: 'JIS' }).drawingStandard).toBe(DEFAULT_DRAWING_STANDARD);
  });
  it('one standard for the whole drawing: setting it on a page sets every page', () => {
    let doc = createEmptyDrawing('ISO');
    doc = applyDrawingCommand(doc, { type: 'insertPage' });
    doc = applyDrawingCommand(doc, { type: 'setSheet', pageIndex: 1, sheet: { standard: 'CNS' } });
    expect(doc.pages.map((p) => p.sheet.standard)).toEqual(['CNS', 'CNS']);
  });
  it('an unknown standard is refused, by the command and when read from a file', () => {
    expect(() => applyDrawingCommand(createEmptyDrawing(), { type: 'setSheet', sheet: { standard: 'JIS' as DrawingStandard } })).toThrow(/JIS/);
    const text = serializeDrawing(createEmptyDrawing()).replace('"standard": "CNS"', '"standard": "JIS"').replace('"standard":"CNS"', '"standard":"JIS"');
    expect(text).toContain('JIS');
    expect(() => parseDrawing(text)).toThrow(/JIS/);
  });
  it('CNS dimensions are drawn as wide as the sheet\'s thin lines; a style of the drawing\'s own still wins', () => {
    expect(baseDimStyle({ size: 'A3', standard: 'CNS' })).toEqual({ line: 0.18 });
    expect(baseDimStyle({ size: 'A1', standard: 'CNS' })).toEqual({ line: 0.25 });
    expect(baseDimStyle({ size: 'A3', standard: 'CNS', dimStyle: { line: 0.35 } })).toEqual({ line: 0.35 });
    expect(baseDimStyle({ size: 'A3', standard: 'ISO' })).toBeUndefined();
  });
});

describe('1-6 the PDF, the SVG and the DXF write the same widths', () => {
  it.each(CASES)('%s %s', (standard, size) => {
    const e = EXPECTED[standard][size];
    const { scene } = drawing(standard, size);
    const PT = 72 / 25.4;
    // the PDF: the widths its content stream sets (w), back in mm
    const pdf = Buffer.from(toPdf(scene).bytes).toString('latin1');
    const pdfWidths = new Set([...pdf.matchAll(/([\d.]+) w /g)].map((m) => Math.round((Number(m[1]) / PT) * 100) / 100));
    // the DXF: the lineweight (370, 1/100 mm) of each layer
    const dxf = toDxf(scene).split(/\r?\n/).map((l) => l.trim());
    const layer = (name: string) => {
      for (let i = 0; i + 2 < dxf.length; i++) if (dxf[i] === 'AcDbLayerTableRecord' && dxf[i + 1] === '2' && dxf[i + 2] === name) return Number(dxf[dxf.indexOf('370', i) + 1]) / 100;
      return NaN;
    };
    const svg = toSvg(scene);
    const svgWidths = new Set([...svg.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1])));
    for (const w of [e.thick, e.medium, 0.7]) {
      expect(pdfWidths, `PDF ${w}`).toContain(w);
      expect(svgWidths, `SVG ${w}`).toContain(w);
    }
    expect([layer('VISIBLE'), layer('HIDDEN'), layer('CENTER'), layer('THIN'), layer('DIMENSION'), layer('FRAME')]).toEqual([e.thick, e.medium, e.thin, e.thin, e.thin, 0.7]);
    // the CNS centre line has its own linetype in the DXF, with the CNS dashes
    if (standard === 'CNS') expect(dxf.join('\n')).toMatch(/CENTER_CNS[\s\S]*49\n20\n[\s\S]*49\n-1\n[\s\S]*49\n0\.5\n/);
    else expect(dxf).not.toContain('CENTER_CNS');
  });
});

describe('1-7 the version', () => {
  it('a drawing is written at the version of this program, at least 39, and reads back with its standard', () => {
    const doc = createEmptyDrawing();
    const text = serializeDrawing(doc);
    const back = parseDrawing(text);
    expect(back.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
    expect(DRAWING_SCHEMA_VERSION).toBeGreaterThanOrEqual(39);
    expect(back.pages[0]!.sheet.standard).toBe(DEFAULT_DRAWING_STANDARD);
  });
  it('a version 38 drawing is upgraded, names no standard and is drawn to ISO', () => {
    const v38 = JSON.stringify({ kind: 'drawing', schemaVersion: 38, pages: [{ id: 'page1', name: '', sheet: { size: 'A3', orientation: 'landscape', projection: 'third', scale: [1, 1] }, title: {}, views: [] }], properties: {}, idCounters: {} });
    const doc = parseDrawing(v38);
    expect(doc.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
    expect(doc.pages[0]!.sheet.standard).toBeUndefined();
    expect(standardOf(doc.pages[0]!.sheet)).toBe('ISO');
  });
  it('every value of a standard is in its profile', () => {
    for (const s of DRAWING_STANDARDS) for (const size of SHEET_SIZES) {
      const e = EXPECTED[s][size];
      expect(DRAWING_PROFILES[s].lines[size]).toEqual({ thick: e.thick, medium: e.medium, thin: e.thin });
      expect(DRAWING_PROFILES[s].frame[size]).toEqual({ left: e.left, other: e.other });
    }
  });
});
