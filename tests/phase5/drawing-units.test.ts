/**
 * A drawing in inches (schema 8): the sheet says the unit, and the lengths a dimension writes (its number, its tolerance, the notes of a hole, the hole table) are in it; the
 * model, the sheet and the file stay in millimetres. Worked out by hand: 25.4 mm to the inch.
 */
import { describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, parseDrawing, serializeDrawing, viewVectors, type Dimension, type ViewFeature, page } from '@3db/model';
import { buildScene, dimensionText, factsOf, holeNote, holeRows, lengthNumber, toleranceText, type Pickable, type ViewLines } from '@3db/drawing';

const ref = (name: string) => ({ kind: 'face' as const, name });
const lin = (extra: Partial<Dimension> = {}): Dimension => ({ id: 'd', view: 'v', kind: 'linear', a: ref('a'), b: ref('b'), orientation: 'horizontal', offset: 10, ...extra }) as Dimension;

describe('the numbers', () => {
  it('a size: as many decimals as asked (three), in the unit', () => {
    expect(lengthNumber(120, 3, 'mm')).toBe('120');
    expect(lengthNumber(120, 3, 'in')).toBe('4.724');
    expect(lengthNumber(25.4, 3, 'in')).toBe('1');
    expect(dimensionText(lin({ precision: 2 }), 120, undefined, 'in')).toBe('4.72');
  });

  it('a note takes one more decimal in inches (two in millimetres, three in inches)', () => {
    expect(lengthNumber(12.5, 2, 'mm')).toBe('12.5');
    expect(lengthNumber(12.5, 2, 'in')).toBe('0.492');
  });

  it('a diameter and a radius keep their sign, a count and the tolerance', () => {
    const dia = { id: 'd', view: 'v', kind: 'diameter', ref: ref('c'), angle: 0, count: 4 } as Dimension;
    expect(dimensionText(dia, 9, undefined, 'in')).toBe('4×Ø0.354');
    expect(dimensionText({ ...dia, kind: 'radius' } as Dimension, 10, undefined, 'in')).toBe('4×R0.394');
  });
});

describe('the tolerance', () => {
  it('limits are millimetres in the document and inches on the sheet: ±0.05 mm is ±0.002, +0.1/−0.05 is +0.0039/−0.0020 (both of four decimals)', () => {
    expect(toleranceText({ type: 'bilateral', upper: 0.05, lower: -0.05 }, 20, 'mm')).toBe('±0.05');
    expect(toleranceText({ type: 'bilateral', upper: 0.05, lower: -0.05 }, 20, 'in')).toBe('±0.002');
    expect(toleranceText({ type: 'bilateral', upper: 0.1, lower: -0.05 }, 20, 'in')).toBe('+0.0039/-0.0020');
  });

  it('a class: its limits come from the table in millimetres and are written in inches: H7 of 6 mm is +0.012/0, +0.0005/0', () => {
    expect(toleranceText({ type: 'fit', fit: 'H7' }, 6, 'mm')).toBe('H7 (+0.012/0)');
    expect(toleranceText({ type: 'fit', fit: 'H7' }, 6, 'in')).toBe('H7 (+0.0005/0)');
  });

  it('on a dimension, whatever its text', () => {
    expect(dimensionText(lin({ tolerance: { type: 'bilateral', upper: 0.05, lower: -0.05 } }), 120, undefined, 'in')).toBe('4.724 ±0.002');
  });
});

describe('what is written of a hole', () => {
  const hole = { through: false, depth: 12.5, counterbore: { diameter: 15, depth: 8 } };
  it('the depth and the counterbore in inches, the angle of a countersink as it is', () => {
    expect(holeNote(hole, 'mm')).toContain('12.5');
    expect(holeNote(hole, 'in')).toContain('0.492');
    expect(holeNote(hole, 'in')).toContain('0.591');
    expect(holeNote({ through: true, depth: 5, countersink: { diameter: 12, angle: 90 } }, 'in')).toContain('90');
  });

  it('the hole table: the size in inches, the places from the corner in inches, the class still by the diameter in millimetres', () => {
    const circle: ViewFeature = { type: 'circle', ref: ref('c'), centre: [30, 20], radius: 4.5, convex: false, full: true, outward: 0, hole: { through: true, depth: 10 } };
    const planes: ViewFeature[] = [{ type: 'plane', ref: ref('l'), axis: 'x', coord: 0, area: 1 }, { type: 'plane', ref: ref('b'), axis: 'y', coord: 0, area: 1 }];
    const mm = holeRows([...planes, circle], { '9': 'H11' }, 'mm');
    const inch = holeRows([...planes, circle], { '9': 'H11' }, 'in');
    expect(mm[0]!.size).toBe('Ø9 H11 (+0.09/0) 貫穿');
    expect(inch[0]!.size).toBe('Ø0.354 H11 (+0.0035/0) 貫穿');
    expect([inch[0]!.x, inch[0]!.y]).toEqual([30, 20]); // the numbers stay millimetres; the table writes them in the unit
  });
});

describe('the sheet', () => {
  it('says its unit: inches, back to millimetres (which takes the mark away); anything else is refused', () => {
    let d = applyDrawingCommand(createEmptyDrawing(), { type: 'setSheet', sheet: { unit: 'in' } });
    expect(page(d).sheet.unit).toBe('in');
    d = applyDrawingCommand(d, { type: 'setSheet', sheet: { scale: [1, 2] } });
    expect(page(d).sheet.unit).toBe('in'); // the other fields leave it
    d = applyDrawingCommand(d, { type: 'setSheet', sheet: { unit: 'mm' } });
    expect('unit' in page(d).sheet).toBe(false);
    expect(() => applyDrawingCommand(d, { type: 'setSheet', sheet: { unit: 'ft' as never } })).toThrow();
  });

  it('is kept in the file', () => {
    const d = applyDrawingCommand(createEmptyDrawing(), { type: 'setSheet', sheet: { unit: 'in' } });
    expect(page(parseDrawing(serializeDrawing(d))).sheet.unit).toBe('in');
  });

  it('writes the dimensions of the drawing in inches: the same dimension says 120 and 4.724', () => {
    const base = applyDrawingCommand(
      applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'v', name: 'v', source: 'x.3dbx', direction: 'front' }] }),
      { type: 'insertDimensions', dimensions: [{ id: 'd', view: 'v', kind: 'linear', a: ref('a'), b: ref('b'), orientation: 'horizontal', offset: 10 }] },
    );
    const v = viewVectors('front');
    const axes = { dir: v.dir, up: v.up };
    const planes = [factsOf({ type: 'plane', ref: ref('a'), axis: 'x', coord: 0, area: 1 } as Pickable, axes), factsOf({ type: 'plane', ref: ref('b'), axis: 'x', coord: 120, area: 1 } as Pickable, axes)];
    const lines = new Map<string, ViewLines>([['v', { visible: [[0, 0, 120, 0, 120, 30, 0, 30, 0, 0]], hidden: [], box: { min: [0, 0], max: [120, 30] } }]]);
    const elements = new Map([['d', { elements: planes }]]);
    const text = (unit: 'mm' | 'in') => buildScene(applyDrawingCommand(base, { type: 'setSheet', sheet: { unit } }), lines, elements).dimensions.get('d');
    expect((text('mm') as { text: string }).text).toBe('120');
    expect((text('in') as { text: string }).text).toBe('4.724');
  });
});
