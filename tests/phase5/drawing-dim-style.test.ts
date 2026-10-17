/**
 * ADR 0146 (4, 5): the style a dimension is drawn in — text height, arrowhead length and kind, line width — the drawing's (`sheet.dimStyle`) and a dimension's own
 * (`style`). Every size is measured on what is drawn (the text's height, the arrowhead's polygon, the line's width), never taken from the style it was given.
 */
import { describe, expect, it } from 'vitest';
import { applyDrawingCommand, ARROW_STYLES, createEmptyDrawing, DIM_STYLE_DEFAULT, DIM_STYLE_LIMITS, resolveDimStyle, viewVectors, type ArrowStyle, type Dimension, type DimStyle, type DrawingDoc, type ElementFacts, page } from '@3db/model';
import { buildScene, evaluateDimension, toDxf, toPdf, toSvg, type PlacedView, type SceneItem, type ViewLines } from '@3db/drawing';

const axes = viewVectors('front');
const placed: PlacedView = { id: 'f', at: [150, 150], scale: 1, w: 40, h: 20, centre: [20, 10] };
const plane = (x: number): ElementFacts => ({ kind: 'face', type: 'plane', point: [x, 10, 0], dir: [1, 0, 0] });
const hole: ElementFacts = { kind: 'face', type: 'cylinder', point: [20, 10, 0], dir: [0, 0, 1], radius: 5 };
const linear: Dimension = { id: 'd1', view: 'f', kind: 'linear', a: { kind: 'face', name: 'a' }, b: { kind: 'face', name: 'b' }, orientation: 'horizontal', offset: 10 };
const diameter: Dimension = { id: 'd2', view: 'f', kind: 'diameter', ref: { kind: 'face', name: 'c' }, angle: 30 };

const draw = (d: Dimension, st: Required<DimStyle>): SceneItem[] => {
  const out = evaluateDimension(d, { elements: d.kind === 'linear' ? [plane(0), plane(40)] : [hole] }, axes, placed, 'mm', st);
  if ('error' in out) throw new Error(out.error);
  return out.items;
};
const polys = (items: SceneItem[]) => items.filter((i): i is Extract<SceneItem, { kind: 'polyline' }> => i.kind === 'polyline');
const pts = (p: Extract<SceneItem, { kind: 'polyline' }>) => Array.from({ length: p.points.length / 2 }, (_, i) => [p.points[2 * i]!, p.points[2 * i + 1]!] as [number, number]);
const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** What the arrowheads of a linear dimension measure: their kind as drawn, their length and spread, and the lines' widths. */
function measure(items: SceneItem[]) {
  const ps = polys(items);
  const filled = ps.filter((p) => p.filled);
  const texts = items.filter((i): i is Extract<SceneItem, { kind: 'text' }> => i.kind === 'text');
  return { ps, filled, texts, widths: new Set(ps.map((p) => p.width ?? 0.25)) };
}

describe('the sizes drawn are the style\'s', () => {
  it('ISO\'s style is drawn as it always was: 3.5 mm text, 3 mm filled arrows half a millimetre each side, the dimension style\'s own width', () => {
    const m = measure(draw(linear, DIM_STYLE_DEFAULT));
    expect(m.texts.map((t) => t.height)).toEqual([3.5]);
    expect(m.filled).toHaveLength(2);
    for (const a of m.filled) {
      const [tip, b1, b2] = pts(a);
      expect(dist(tip!, [(b1![0] + b2![0]) / 2, (b1![1] + b2![1]) / 2])).toBeCloseTo(3, 9);
      expect(dist(b1!, b2!) / 2).toBeCloseTo(0.5, 9);
    }
    // no width is written on a line drawn in the style's own
    expect(m.ps.every((p) => p.width === undefined)).toBe(true);
  });

  it.each(ARROW_STYLES)('a %s arrowhead is drawn as that kind, of the length asked', (arrowStyle) => {
    const st = { ...DIM_STYLE_DEFAULT, arrowStyle, arrow: 4.5, text: 6, line: 0.5 };
    const m = measure(draw(linear, st));
    const plain = measure(draw(linear, { ...st, arrowStyle: 'none' }));
    expect(m.texts.map((t) => t.height)).toEqual([6]);
    expect([...m.widths]).toEqual([0.5]);
    // what the arrowheads add to a dimension with none
    const heads = m.ps.slice(0).filter((p) => !plain.ps.some((q) => q.points.join() === p.points.join()));
    if (arrowStyle === 'none') return expect(heads).toHaveLength(0);
    expect(heads).toHaveLength(2);
    // the dimension line runs along x here, its ends at x = 150 - 20 and 150 + 20 on the sheet
    const ends: [number, number][] = [[130, 170], [170, 170]];
    for (const h of heads) {
      const p = pts(h);
      if (arrowStyle === 'filled' || arrowStyle === 'open') {
        expect(!!h.filled).toBe(arrowStyle === 'filled');
        const [b1, tip, b2] = arrowStyle === 'open' ? p : [p[1]!, p[0]!, p[2]!];
        expect(dist(tip!, [(b1![0] + b2![0]) / 2, (b1![1] + b2![1]) / 2])).toBeCloseTo(4.5, 9);
        expect(dist(b1!, b2!) / 2).toBeCloseTo(4.5 / 6, 9);
        expect(ends.some((e) => dist(e, tip!) < 1e-9)).toBe(true);
      } else if (arrowStyle === 'tick') {
        expect(p).toHaveLength(2);
        expect(dist(p[0]!, p[1]!)).toBeCloseTo(4.5, 9);
        // 45° across the dimension line, its middle on the line's end
        expect(Math.abs(p[1]![0] - p[0]![0])).toBeCloseTo(Math.abs(p[1]![1] - p[0]![1]), 9);
        const mid: [number, number] = [(p[0]![0] + p[1]![0]) / 2, (p[0]![1] + p[1]![1]) / 2];
        expect(ends.some((e) => dist(e, mid) < 1e-9)).toBe(true);
      } else {
        expect(h.filled && h.closed).toBe(true);
        const centre = ends.find((e) => p.every((q) => Math.abs(dist(q, e) - 4.5 / 5) < 1e-9));
        expect(centre).toBeDefined();
      }
    }
  });

  it('a circle\'s leader takes the style too', () => {
    const m = measure(draw(diameter, { ...DIM_STYLE_DEFAULT, text: 5, arrow: 2 }));
    expect(m.texts.every((t) => t.height === 5)).toBe(true);
    for (const a of m.filled) {
      const [tip, b1, b2] = pts(a);
      expect(dist(tip!, [(b1![0] + b2![0]) / 2, (b1![1] + b2![1]) / 2])).toBeCloseTo(2, 9);
    }
  });

  it('fuzz: 200 styles within the limits are each drawn at exactly their sizes', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const within = (k: 'text' | 'arrow' | 'line') => DIM_STYLE_LIMITS[k][0] + rnd() * (DIM_STYLE_LIMITS[k][1] - DIM_STYLE_LIMITS[k][0]);
    for (let n = 0; n < 200; n++) {
      const st: Required<DimStyle> = { text: within('text'), arrow: within('arrow'), line: within('line'), arrowStyle: ARROW_STYLES[Math.floor(rnd() * 5)]! };
      for (const d of [linear, diameter]) {
        const m = measure(draw(d, st));
        expect(m.texts.every((t) => t.height === st.text)).toBe(true);
        for (const p of m.ps) expect(p.width ?? DIM_STYLE_DEFAULT.line).toBe(st.line);
        if (st.arrowStyle === 'filled') for (const a of m.filled) {
          const [tip, b1, b2] = pts(a);
          expect(dist(tip!, [(b1![0] + b2![0]) / 2, (b1![1] + b2![1]) / 2])).toBeCloseTo(st.arrow, 9);
        }
      }
    }
  });
});

/** A drawing with a front view and the linear dimension on it. */
function withDimension(): DrawingDoc {
  let doc = applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'f', name: 'F', source: 'p.3dbx', direction: 'front', at: [150, 150] }] });
  doc = applyDrawingCommand(doc, { type: 'insertDimensions', dimensions: [linear] });
  return doc;
}
const lines = new Map<string, ViewLines>([['f', { visible: [[0, 0, 40, 0, 40, 20, 0, 20, 0, 0]], hidden: [], box: { min: [0, 0], max: [40, 20] } }]]);
const elements = new Map([['d1', { elements: [plane(0), plane(40)] }]]);

describe('the drawing\'s style and a dimension\'s own', () => {
  it('a dimension is drawn in its own sizes over the drawing\'s, over ISO\'s; null takes either away', () => {
    let doc = applyDrawingCommand(withDimension(), { type: 'setSheet', sheet: { dimStyle: { text: 5, arrowStyle: 'tick' } } });
    const texts = (d: DrawingDoc) => buildScene(d, lines, elements).scene.items.filter((i) => i.kind === 'text' && i.group === 'd1').map((i) => (i as { height: number }).height);
    expect(texts(doc)).toEqual([5]);
    doc = applyDrawingCommand(doc, { type: 'setDimension', dimensionId: 'd1', patch: { style: { text: 7 } } });
    expect(texts(doc)).toEqual([7]);
    expect(resolveDimStyle(page(doc).sheet.dimStyle, page(doc).dimensions[0]!.style)).toEqual({ text: 7, arrow: 3, arrowStyle: 'tick', line: 0.25 });
    doc = applyDrawingCommand(doc, { type: 'setDimension', dimensionId: 'd1', patch: { style: null } });
    expect(page(doc).dimensions[0]).not.toHaveProperty('style');
    expect(texts(doc)).toEqual([5]);
    doc = applyDrawingCommand(doc, { type: 'setSheet', sheet: { dimStyle: null } });
    expect(page(doc).sheet).not.toHaveProperty('dimStyle');
    expect(texts(doc)).toEqual([3.5]);
    // an empty style is no style
    expect(page(applyDrawingCommand(doc, { type: 'setSheet', sheet: { dimStyle: {} } })).sheet).not.toHaveProperty('dimStyle');
  });

  it('refuses a size out of its limits, not a number, or a field or arrow it does not know — nothing is rounded or put in range', () => {
    const doc = withDimension();
    const bad: unknown[] = [{ text: 0 }, { text: -3.5 }, { text: Number.NaN }, { text: Number.POSITIVE_INFINITY }, { text: 20.0001 }, { arrow: 0.49 }, { arrow: 21 }, { line: 0.1 }, { line: 2.5 }, { text: '5' }, { arrowStyle: 'big' }, { colour: 'red' }, 'large', [1]];
    for (const s of bad) {
      expect(() => applyDrawingCommand(doc, { type: 'setSheet', sheet: { dimStyle: s as DimStyle } }), JSON.stringify(s)).toThrow();
      expect(() => applyDrawingCommand(doc, { type: 'setDimension', dimensionId: 'd1', patch: { style: s as DimStyle } }), JSON.stringify(s)).toThrow();
    }
    // the limits themselves are allowed
    for (const k of ['text', 'arrow', 'line'] as const) for (const v of DIM_STYLE_LIMITS[k]) expect(page(applyDrawingCommand(doc, { type: 'setSheet', sheet: { dimStyle: { [k]: v } } })).sheet.dimStyle).toEqual({ [k]: v });
  });

  it('the outputs draw it: the SVG\'s and the PDF\'s line widths, the DXF\'s dimension style and lineweights', () => {
    const doc = applyDrawingCommand(withDimension(), { type: 'setSheet', sheet: { dimStyle: { text: 5, arrow: 4, line: 0.35 } } });
    const scene = buildScene(doc, lines, elements).scene;
    expect(toSvg(scene)).toContain('stroke-width="0.35"');
    expect(new TextDecoder('latin1').decode(toPdf(scene).bytes)).toContain(`${Math.round(0.35 * (72 / 25.4) * 1000) / 1000} w`);
    const dxf = toDxf(scene).split(/\r?\n/).map((s) => s.trim());
    const after = (code: string, from: number) => dxf[dxf.indexOf(code, from) + 1];
    const style = dxf.indexOf('DIMSTYLE', dxf.indexOf('DIMSTYLE') + 1);
    expect(Number(after('140', style))).toBe(5);
    expect(Number(after('41', style))).toBe(4);
    expect(dxf.filter((l, i) => l === '370' && dxf[i + 1] === '35').length).toBeGreaterThan(0);
  });
});

it('an arrow style is one of five', () => {
  const kinds: readonly ArrowStyle[] = ARROW_STYLES;
  expect(kinds).toEqual(['filled', 'open', 'tick', 'dot', 'none']);
});
