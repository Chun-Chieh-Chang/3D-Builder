/**
 * B2.4 (2026-10-19): the tolerance submenu of a dimension's right-click menu. It is a shortcut and adds nothing to the file — it writes the same
 * `DimensionTolerance` the properties panel writes (ADR 0125) — so what is pinned here is the mapping, and the rule the model itself keeps: a fit is a size's,
 * so an angle and an ordinate have none, and the menu leaves that choice out rather than let the command fail.
 */
import { describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, type Dimension, type DrawingDoc, type Ref, page } from '@3db/model';
import { fitAllowed, toleranceForChoice } from '@3db/drawing';

const ref = (name: string): Ref => ({ kind: 'face', name });
const base = (): DrawingDoc =>
  applyDrawingCommand(createEmptyDrawing(), {
    type: 'insertViews',
    views: [{ id: 'view1', name: 'f', source: 'a.3dbx', direction: 'top' }],
  });

describe('the tolerance a dimension menu puts on a dimension (B2.4)', () => {
  it('takes it away, or puts the two limits ±0.05 on it', () => {
    expect(toleranceForChoice('none', 'linear')).toBeNull();
    expect(toleranceForChoice('bilateral', 'linear')).toEqual({ type: 'bilateral', upper: 0.05, lower: -0.05 });
    expect(toleranceForChoice('bilateral', 'angle')).toEqual({ type: 'bilateral', upper: 0.05, lower: -0.05 });
  });

  it('puts MAX and MIN on it', () => {
    expect(toleranceForChoice('max', 'linear')).toEqual({ type: 'max' });
    expect(toleranceForChoice('min', 'diameter')).toEqual({ type: 'min' });
  });

  it("puts a shaft's fit on a linear size and a hole's elsewhere, as the panel does", () => {
    expect(toleranceForChoice('fit', 'linear')).toEqual({ type: 'fit', fit: 'h7' });
    expect(toleranceForChoice('fit', 'diameter')).toEqual({ type: 'fit', fit: 'H7' });
    expect(toleranceForChoice('fit', 'radius')).toEqual({ type: 'fit', fit: 'H7' });
  });

  it('leaves the fit out for the kinds that have no size: an angle and an ordinate', () => {
    expect(fitAllowed(['linear', 'diameter', 'radius'])).toBe(true);
    expect(fitAllowed(['linear', 'angle'])).toBe(false);
    expect(fitAllowed(['ordinate'])).toBe(false);
  });

  it('what it writes is what the document takes, and only where the model allows it', () => {
    const linear: Dimension = { id: 'dim1', view: 'view1', kind: 'linear', a: ref('a'), b: ref('b'), orientation: 'horizontal', offset: -10 };
    let d = applyDrawingCommand(base(), { type: 'insertDimensions', dimensions: [linear] });
    d = applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim1', patch: { tolerance: toleranceForChoice('fit', 'linear') } });
    expect(page(d).dimensions[0]).toMatchObject({ tolerance: { type: 'fit', fit: 'h7' } });
    d = applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim1', patch: { tolerance: toleranceForChoice('none', 'linear') } });
    expect(page(d).dimensions[0]).not.toHaveProperty('tolerance');

    const angle: Dimension = { id: 'dim2', view: 'view1', kind: 'angle', a: ref('a'), b: ref('b'), arc: 10 };
    d = applyDrawingCommand(d, { type: 'insertDimensions', dimensions: [angle] });
    expect(fitAllowed([angle.kind])).toBe(false);
    // the menu leaves the fit out for an angle because the model refuses it: this is that refusal, from the model itself
    expect(() => applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim2', patch: { tolerance: { type: 'fit', fit: 'H7' } } })).toThrow(/角度尺寸的公差/);

    const ordinate: Dimension = { id: 'dim3', view: 'view1', kind: 'ordinate', axis: 'x', origin: ref('o'), refs: [ref('a')], offset: -10 };
    d = applyDrawingCommand(d, { type: 'insertDimensions', dimensions: [ordinate] });
    expect(fitAllowed([ordinate.kind])).toBe(false);
    expect(() => applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim3', patch: { tolerance: { type: 'fit', fit: 'H7' } } })).toThrow(/座標尺寸不能用配合/);
  });
});
