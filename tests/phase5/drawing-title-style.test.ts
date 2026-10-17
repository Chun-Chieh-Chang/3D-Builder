/**
 * ADR 0150: the title block's text style — the height of a cell's field name, of the text it holds, of the drawing's own title, and the fit of a text too wide
 * for its cell. Every height is measured on what is drawn (the scene's text items, the SVG's font-size, the DXF's group 40, the PDF's Tf size), never taken
 * from the style it was given; the fit is checked against the same width the PDF writer lays out with.
 */
import { describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, DRAWING_SCHEMA_VERSION, parseDrawing, serializeDrawing, TITLE_STYLE_DEFAULT, TITLE_STYLE_LIMITS, TITLE_STYLE_SUM_LIMITS, type DrawingDoc, type TitleField, type TitleStyle, page } from '@3db/model';
import { olderDrawingFile } from '../support/drawingVersion';
import { fittedTitleHeight, sheetItems, sheetMetrics, textWidthMm, titleCells, toDxf, toPdf, toSvg, TITLE_FIT_MIN, type Scene, type SceneItem } from '@3db/drawing';

type TextItem = Extract<SceneItem, { kind: 'text' }>;

/** A drawing with the title block written and, when given, its text style. */
function titled(title: Partial<Record<TitleField, string>>, style?: TitleStyle): DrawingDoc {
  let doc = createEmptyDrawing();
  for (const [field, value] of Object.entries(title) as [TitleField, string][]) doc = applyDrawingCommand(doc, { type: 'setTitle', field, value });
  if (style) doc = applyDrawingCommand(doc, { type: 'setSheet', sheet: { titleStyle: style } });
  return doc;
}

const ALL: Record<TitleField, string> = { company: 'ACME', drawingName: 'BRACKET', drawingNo: 'DWG-1', material: 'AL', generalTolerance: '+/- 0.1', drafter: 'AB', date: '2026-10-16', revision: 'A' };

const textItems = (doc: DrawingDoc): TextItem[] => sheetItems(doc).filter((i): i is TextItem => i.kind === 'text');
const drawn = (doc: DrawingDoc, text: string): TextItem => textItems(doc).find((i) => i.text === text)!;
/** The name of one cell, found by the exact baseline its height puts it at (several cells share the same left edge). */
const nameAt = (doc: DrawingDoc, x: number, y: number, h: number, height: number): TextItem | undefined =>
  textItems(doc).find((i) => Math.abs(i.at[0] - x) < 1e-9 && Math.abs(i.at[1] - (y + h - 0.8 - height)) < 1e-9);

const sceneOf = (doc: DrawingDoc): Scene => {
  const m = sheetMetrics(page(doc).sheet);
  return { width: m.width, height: m.height, items: sheetItems(doc) };
};

describe('the title block as it has always been drawn', () => {
  it('with no style: 2.2 mm names 3 mm below the top of each cell, 3.5 mm values, a 6 mm title', () => {
    const doc = titled(ALL);
    const m = sheetMetrics(page(doc).sheet);
    for (const c of titleCells()) {
      const x = m.titleBlock.x + c.x;
      const y = m.titleBlock.y + c.y;
      const name = textItems(doc).find((i) => Math.abs(i.at[0] - (x + 1)) < 1e-9 && Math.abs(i.at[1] - (y + c.h - 3)) < 1e-9);
      expect(name, `the name of ${c.field} at y + h - 3`).toBeDefined();
      expect(name!.height).toBeCloseTo(TITLE_STYLE_DEFAULT.label, 12);
      const value = textItems(doc).find((i) => Math.abs(i.at[0] - (x + 2)) < 1e-9 && Math.abs(i.at[1] - (y + (c.large ? 3.5 : 2.2))) < 1e-9);
      expect(value, `the value of ${c.field}`).toBeDefined();
      expect(value!.height).toBeCloseTo(c.large ? 6 : 3.5, 12);
    }
  });
});

describe('the heights drawn are the style\'s', () => {
  it('a style writes every text of the block at its height; the name keeps 0.8 mm below the top of the cell', () => {
    const doc = titled(ALL, { label: 2.5, value: 4.5, title: 9 });
    const m = sheetMetrics(page(doc).sheet);
    for (const c of titleCells()) {
      const name = nameAt(doc, m.titleBlock.x + c.x + 1, m.titleBlock.y + c.y, c.h, 2.5);
      expect(name, `the name of ${c.field}`).toBeDefined();
      expect(name!.at[1]).toBeCloseTo(m.titleBlock.y + c.y + c.h - 0.8 - 2.5, 12);
      expect(name!.height).toBeCloseTo(2.5, 12);
    }
    expect(drawn(doc, 'BRACKET').height).toBeCloseTo(9, 12);
    expect(drawn(doc, 'ACME').height).toBeCloseTo(4.5, 12);
    // the date is 32 mm at 4.5 mm and the cell leaves 27: the fit shrinks it, and the shrunk height is exactly the ratio of the overflow
    const date = drawn(doc, '2026-10-16');
    expect(date.height).toBeLessThan(4.5);
    expect(date.height).toBeCloseTo((4.5 * 27) / textWidthMm('2026-10-16', 4.5), 9);
  });

  it('null takes the style away and the block is ISO\'s again; an empty style is no style', () => {
    const doc = applyDrawingCommand(titled(ALL, { value: 4.5 }), { type: 'setSheet', sheet: { titleStyle: null } });
    expect(page(doc).sheet).not.toHaveProperty('titleStyle');
    expect(drawn(doc, 'ACME').height).toBeCloseTo(3.5, 12);
    expect(page(applyDrawingCommand(doc, { type: 'setSheet', sheet: { titleStyle: {} } })).sheet).not.toHaveProperty('titleStyle');
  });
});

describe('a text too wide for its cell', () => {
  const long = 'M'.repeat(20); // 20 × 833/1000 em: 81 mm at 3.5 mm — past the 47 mm the 50 mm material cell leaves

  it('is drawn shrunk to the cell by exactly the ratio of the overflow; what fits is never grown', () => {
    const doc = titled({ ...ALL, material: long });
    const cell = titleCells().find((c) => c.field === 'material')!;
    const avail = cell.w - 3;
    const h = drawn(doc, long).height;
    expect(h).toBeLessThan(3.5);
    expect(textWidthMm(long, h)).toBeLessThanOrEqual(avail + 1e-9);
    expect(h).toBeCloseTo((3.5 * avail) / textWidthMm(long, 3.5), 9);
    expect(drawn(doc, 'AB').height).toBeCloseTo(3.5, 12);
  });

  it('off, the text keeps the height of the style and runs over the cell as it always did', () => {
    const doc = titled({ ...ALL, material: long }, { fit: false });
    expect(drawn(doc, long).height).toBeCloseTo(3.5, 12);
    expect(fittedTitleHeight(long, 3.5, 50, false)).toBe(3.5);
  });

  it('shrinks no further than 1.8 mm, whatever the text: what still does not fit is left to overflow', () => {
    const huge = long.repeat(10);
    const doc = titled({ ...ALL, material: huge });
    expect(drawn(doc, huge).height).toBeCloseTo(TITLE_FIT_MIN, 12);
    expect(fittedTitleHeight(huge, 6, 100, true)).toBe(TITLE_FIT_MIN);
  });
});

describe('what the style refuses', () => {
  it('a height out of its limits, not a number, a fit that is not on or off, a field it does not know — nothing is rounded or put in range', () => {
    const doc = titled(ALL);
    const bad: unknown[] = [
      { label: 1.9 }, { label: 5.01 }, { value: 1.99 }, { value: 5.01 }, { title: 2.9 }, { title: 9.51 },
      { label: Number.NaN }, { title: Number.POSITIVE_INFINITY }, { value: '3.5' }, { fit: 'yes' }, { colour: 'red' }, 'large', [1],
    ];
    for (const s of bad) expect(() => applyDrawingCommand(doc, { type: 'setSheet', sheet: { titleStyle: s as TitleStyle } }), JSON.stringify(s)).toThrow();
    // the limits themselves are allowed — with a partner small enough to stay inside the sums
    expect(page(applyDrawingCommand(doc, { type: 'setSheet', sheet: { titleStyle: { label: 2, value: 5 } } })).sheet.titleStyle).toEqual({ label: 2, value: 5 });
    expect(page(applyDrawingCommand(doc, { type: 'setSheet', sheet: { titleStyle: { label: 5, value: 2 } } })).sheet.titleStyle).toEqual({ label: 5, value: 2 });
    expect(page(applyDrawingCommand(doc, { type: 'setSheet', sheet: { titleStyle: { label: 2, title: 9.5 } } })).sheet.titleStyle).toEqual({ label: 2, title: 9.5 });
  });

  it('a name and the text under it too tall for the same cell, though each is within its own limits', () => {
    const doc = titled(ALL);
    for (const s of [{ label: 4, value: 3.1 }, { label: 2.5, title: 9.5 }, { label: 3.6 }]) {
      expect(() => applyDrawingCommand(doc, { type: 'setSheet', sheet: { titleStyle: s } }), JSON.stringify(s)).toThrow();
    }
    // the sums themselves are allowed
    expect(page(applyDrawingCommand(doc, { type: 'setSheet', sheet: { titleStyle: { label: 2.2, title: TITLE_STYLE_SUM_LIMITS.labelPlusTitle - 2.2 } } })).sheet.titleStyle).toEqual({ label: 2.2, title: 9.5 });
  });
});

describe('fuzz: 200 styles and texts', () => {
  it('each text is drawn at most at its style, fits its cell when it can, and is shrunk by exactly the ratio of the overflow', () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const within = (k: 'label' | 'value' | 'title') => TITLE_STYLE_LIMITS[k][0] + rnd() * (TITLE_STYLE_LIMITS[k][1] - TITLE_STYLE_LIMITS[k][0]);
    const words = ['AB', 'WESLEY CHANG', 'C.3 檢具', 'ISO 286-2 f7', 'M'.repeat(1 + Math.floor(rnd() * 40)), '星vax 樹脂'];
    let drawn200 = 0;
    for (let n = 0; n < 5000 && drawn200 < 200; n++) {
      const style: TitleStyle = { label: within('label'), value: within('value'), title: within('title'), fit: rnd() > 0.5 };
      let doc: DrawingDoc;
      try {
        doc = titled({ material: words[Math.floor(rnd() * words.length)]! }, style);
      } catch {
        continue; // a draw the sums refuse: try another
      }
      drawn200++;
      const cell = titleCells().find((c) => c.field === 'material')!;
      const avail = cell.w - 3;
      const text = page(doc).title.material!;
      const h = drawn(doc, text).height;
      const over = textWidthMm(text, style.value!) > avail;
      if (!style.fit || !over) expect(h).toBeCloseTo(style.value!, 12);
      else if (h > TITLE_FIT_MIN + 1e-12) expect(textWidthMm(text, h)).toBeLessThanOrEqual(avail + 1e-9);
      else expect(h).toBeCloseTo(TITLE_FIT_MIN, 12);
    }
    expect(drawn200).toBe(200);
  });
});

describe('the outputs draw it', () => {
  it('the SVG\'s font-size, the DXF\'s TEXT height and the PDF\'s Tf size all carry the height as drawn', () => {
    const doc = titled(ALL, { label: 2.5, value: 4.5, title: 9 });
    const scene = sceneOf(doc);
    const svg = toSvg(scene);
    const fontSizes = [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(fontSizes.some((f) => Math.abs(f - 9 * 1.4) < 0.01)).toBe(true);
    expect(fontSizes.some((f) => Math.abs(f - 4.5 * 1.4) < 0.01)).toBe(true);

    const dxf = toDxf(scene).split(/\r?\n/).map((s) => s.trim());
    const heights: number[] = [];
    for (let i = 1; i < dxf.length; i++) {
      if (dxf[i] !== 'TEXT' || dxf[i - 1] !== '0') continue; // an entity, not the layer or the subclass marker
      for (let j = i + 1; j + 1 < dxf.length && dxf[j] !== '0'; j += 2) if (dxf[j] === '40') heights.push(Number(dxf[j + 1]));
    }
    expect(heights.some((h) => Math.abs(h - 9) < 1e-9)).toBe(true);
    expect(heights.some((h) => Math.abs(h - 4.5) < 1e-9)).toBe(true);

    const pdf = new TextDecoder('latin1').decode(toPdf(scene).bytes);
    const sizes = [...pdf.matchAll(/\/F1 ([\d.]+) Tf/g)].map((m) => Number(m[1]));
    expect(sizes.some((s) => Math.abs(s - (9 / 0.718) * (72 / 25.4)) < 0.01)).toBe(true);
  });
});

describe('the file keeps it', () => {
  it('a saved drawing comes back with its title style; a v19 file, which never had one, comes back without', () => {
    const doc = titled(ALL, { label: 2.5, value: 4, title: 9, fit: false });
    expect(page(parseDrawing(serializeDrawing(doc))).sheet.titleStyle).toEqual({ label: 2.5, value: 4, title: 9, fit: false });
    const back = parseDrawing(JSON.stringify(olderDrawingFile(titled(ALL), 19)));
    expect(page(back).sheet).not.toHaveProperty('titleStyle');
    expect(back.schemaVersion).toBe(DRAWING_SCHEMA_VERSION); // upgraded, with nothing to convert
  });
});
