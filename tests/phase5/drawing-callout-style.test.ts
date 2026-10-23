import { describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, DRAWING_SCHEMA_VERSION, DrawingHistory, page, parseDrawing, serializeDrawing, type DiameterDimension, type Dimension } from '@3db/model';
import { cosmeticThreadText, dxfEscape, dxfUnescape, readDxf, readPdf, toDxf, toPdf, type DxfDimension, type DxfText, type Scene } from '@3db/drawing';

const dimension: DiameterDimension = { id: 'd1', view: 'view1', kind: 'diameter', ref: { kind: 'face', name: 'hole:wall' }, angle: 45, callout: true };
const drawing = () => applyDrawingCommand(applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'view1', name: 'Front', source: 'part.3dbx', direction: 'front' }] }), { type: 'insertDimensions', dimensions: [dimension] });

describe('callout style persistence and input validation', () => {
  it('round trips, undoes, redoes and clears the style without storing any model depth', () => {
    const history = new DrawingHistory(drawing());
    history.execute({ type: 'setDimension', dimensionId: 'd1', patch: { calloutStyle: 'symbols' } }, 'style');
    const doc = history.doc;
    expect(doc.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
    expect(DRAWING_SCHEMA_VERSION).toBeGreaterThanOrEqual(26);
    expect(page(parseDrawing(serializeDrawing(doc))).dimensions[0]).toEqual({ ...dimension, calloutStyle: 'symbols' });
    history.undo();
    expect(page(history.doc).dimensions[0]).not.toHaveProperty('calloutStyle');
    history.redo();
    expect(page(history.doc).dimensions[0]).toHaveProperty('calloutStyle', 'symbols');
    const cleared = applyDrawingCommand(history.doc, { type: 'setDimension', dimensionId: 'd1', patch: { calloutStyle: null } });
    expect(page(cleared).dimensions[0]).toEqual(dimension);
    const old = { ...drawing(), schemaVersion: 25 };
    expect(page(parseDrawing(JSON.stringify(old))).dimensions[0]).toEqual(dimension);
  });

  it('rejects unknown styles, styles on radius dimensions and fake depth fields', () => {
    for (const value of ['unknown', '', 4, false, {}]) {
      expect(() => applyDrawingCommand(drawing(), { type: 'setDimension', dimensionId: 'd1', patch: { calloutStyle: value as never } })).toThrow();
    }
    expect(() => applyDrawingCommand(drawing(), { type: 'insertDimensions', dimensions: [{ ...dimension, id: 'd2', kind: 'radius', callout: undefined, calloutStyle: 'symbols' } as Dimension] })).toThrow();
    expect(() => applyDrawingCommand(drawing(), { type: 'setDimension', dimensionId: 'd1', patch: { depth: 99 } as never })).toThrow();
  });

  it('keeps 150 varied model depths distinct in text and symbol formats', () => {
    for (let i = 1; i <= 150; i++) {
      const depth = i / 4;
      const ct = { majorDiameter: 8, minorDiameter: 6.466, pitch: 1.25, depth, threadType: 'external', endCondition: 'blind', designation: 'M8' } as const;
      expect(cosmeticThreadText(ct, 'mm', 'symbols')).toBe(`M8×1.25 ↧ ${depth}`);
      expect(cosmeticThreadText(ct)).toBe(`M8×1.25 深 ${depth}`);
    }
  });

  it('does not invent a metric standard for custom or imperial threads, or a tolerance class', () => {
    const ct = { majorDiameter: 8, minorDiameter: 6.466, pitch: 1.25, depth: 18, threadType: 'external', endCondition: 'blind' } as const;
    expect(cosmeticThreadText(ct, 'mm', 'symbols')).toBe('自訂螺紋 Ø8 × 1.25 ↧ 18');
    expect(cosmeticThreadText(ct, 'in', 'symbols')).toBe('自訂螺紋 Ø0.315 × 0.0492 ↧ 0.709');
    expect(cosmeticThreadText({ ...ct, designation: '1/4-20 UNC' }, 'mm', 'symbols')).toBe('1/4-20 UNC ↧ 18');
    expect(cosmeticThreadText({ ...ct, designation: 'M8×1' }, 'mm', 'symbols')).toBe('M8×1 ↧ 18');
  });
});

describe('portable manufacturing symbols in exports', () => {
  const text = 'Ø9 ↧ 15 ⌴ Ø15 ↧ 8 ⌵ Ø18 × 90°';
  const fallback = 'Ø9 DEPTH 15 CBORE Ø15 DEPTH 8 CSINK Ø18 × 90°';
  const scene: Scene = {
    width: 420, height: 297,
    items: [{ kind: 'text', group: 'd1', at: [30, 40], height: 3, text }],
    dimensions: [{ id: 'd1', text, textAt: [30, 40], geometry: { kind: 'diameter', far: [0, 0], near: [9, 0], leader: 8 } }],
  };

  it('uses the same readable fallback in DXF override text and its anonymous block', () => {
    expect(dxfUnescape(dxfEscape(text))).toBe(fallback);
    const doc = readDxf(toDxf(scene));
    const d = doc.entities.find((e): e is DxfDimension => e.type === 'DIMENSION');
    expect(d).toBeDefined();
    expect(d!.text).toBe(fallback);
    const blockText = doc.blockEntities.get(d!.block)!.find((e): e is DxfText => e.type === 'TEXT');
    expect(blockText?.text).toBe(fallback);
  });

  it('keeps numbers and manufacturing operations readable with the PDF built-in font', () => {
    const result = toPdf(scene);
    expect(result.warnings).toEqual([]);
    expect(readPdf(result.bytes).pages[0]!.texts[0]!.text).toBe(fallback);
  });
});
