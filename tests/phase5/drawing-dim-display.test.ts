/**
 * E5 Phase 1 (2026-10-23): Drawing circular dimension display format toggle (Diameter ↔ Radius).
 * Pinned behaviors:
 * 1. Toggling kind between 'diameter' and 'radius' updates the dimension in-place.
 * 2. All shared attributes (angle, ref, count, tolerance, reference, leader, style) are preserved.
 * 3. Toggling from diameter with hole callout to radius automatically strips callout.
 * 4. Refuses kind changes on linear, angle, or ordinate dimensions.
 * 5. Refuses invalid kind strings.
 * 6. dimensionText formats correctly with Ø or R according to the toggled kind.
 */
import { describe, expect, it } from 'vitest';
import {
  applyDrawingCommand,
  CommandError,
  createEmptyDrawing,
  type DiameterDimension,
  type Dimension,
  type DrawingDoc,
  type RadiusDimension,
  type Ref,
  page,
} from '@3db/model';
import { dimensionText } from '@3db/drawing';

const ref = (name: string): Ref => ({ kind: 'face', name });
const base = (): DrawingDoc =>
  applyDrawingCommand(createEmptyDrawing(), {
    type: 'insertViews',
    views: [{ id: 'view1', name: 'front', source: 'part.3dbx', direction: 'top' }],
  });

describe('drawing dimension display toggle (diameter <-> radius)', () => {
  it('toggles diameter to radius in-place and preserves shared properties', () => {
    const dia: Dimension = {
      id: 'dim1',
      view: 'view1',
      kind: 'diameter',
      ref: ref('holeFace'),
      angle: 45,
      count: 4,
      reference: true,
      leader: 12,
      tolerance: { type: 'fit', fit: 'H7' },
    };
    let doc = applyDrawingCommand(base(), { type: 'insertDimensions', dimensions: [dia] });
    expect(page(doc).dimensions[0]?.kind).toBe('diameter');

    // Toggle to radius
    doc = applyDrawingCommand(doc, {
      type: 'setDimension',
      dimensionId: 'dim1',
      patch: { kind: 'radius' },
    });
    const rad = page(doc).dimensions[0]! as RadiusDimension;
    expect(rad.kind).toBe('radius');
    expect(rad.angle).toBe(45);
    expect(rad.count).toBe(4);
    expect(rad.reference).toBe(true);
    expect(rad.leader).toBe(12);
    expect(rad.tolerance).toEqual({ type: 'fit', fit: 'H7' });
    expect(rad.ref).toEqual(ref('holeFace'));

    // Check rendered text: R with 4x and tolerance
    const txt = dimensionText(rad, 10);
    expect(txt).toContain('4×');
    expect(txt).toContain('R');
    expect(txt).toContain('H7');
  });

  it('toggles radius back to diameter', () => {
    const rad: Dimension = {
      id: 'dim1',
      view: 'view1',
      kind: 'radius',
      ref: ref('arcFace'),
      angle: 30,
    };
    let doc = applyDrawingCommand(base(), { type: 'insertDimensions', dimensions: [rad] });

    doc = applyDrawingCommand(doc, {
      type: 'setDimension',
      dimensionId: 'dim1',
      patch: { kind: 'diameter' },
    });
    const dia = page(doc).dimensions[0]! as DiameterDimension;
    expect(dia.kind).toBe('diameter');
    expect(dia.angle).toBe(30);

    const txt = dimensionText(dia, 20);
    expect(txt).toContain('Ø');
  });

  it('strips callout when toggling diameter to radius', () => {
    const dia: Dimension = {
      id: 'dim1',
      view: 'view1',
      kind: 'diameter',
      ref: ref('holeFace'),
      angle: 45,
      callout: true,
    };
    let doc = applyDrawingCommand(base(), { type: 'insertDimensions', dimensions: [dia] });
    expect((page(doc).dimensions[0] as any).callout).toBe(true);

    // Toggle to radius strips callout
    doc = applyDrawingCommand(doc, {
      type: 'setDimension',
      dimensionId: 'dim1',
      patch: { kind: 'radius' },
    });
    const rad = page(doc).dimensions[0]!;
    expect(rad.kind).toBe('radius');
    expect((rad as any).callout).toBeUndefined();
  });

  it('refuses kind toggle on linear, angle, and ordinate dimensions', () => {
    const linear: Dimension = {
      id: 'dLin',
      view: 'view1',
      kind: 'linear',
      a: ref('a'),
      b: ref('b'),
      orientation: 'horizontal',
      offset: 10,
    };
    const angle: Dimension = {
      id: 'dAng',
      view: 'view1',
      kind: 'angle',
      a: ref('a'),
      b: ref('b'),
      arc: 20,
    };
    const ord: Dimension = {
      id: 'dOrd',
      view: 'view1',
      kind: 'ordinate',
      axis: 'x',
      origin: ref('origin'),
      refs: [ref('hole1')],
      offset: 15,
    };
    const doc = applyDrawingCommand(base(), {
      type: 'insertDimensions',
      dimensions: [linear, angle, ord],
    });

    expect(() =>
      applyDrawingCommand(doc, {
        type: 'setDimension',
        dimensionId: 'dLin',
        patch: { kind: 'radius' },
      })
    ).toThrow(CommandError);

    expect(() =>
      applyDrawingCommand(doc, {
        type: 'setDimension',
        dimensionId: 'dAng',
        patch: { kind: 'diameter' },
      })
    ).toThrow(CommandError);

    expect(() =>
      applyDrawingCommand(doc, {
        type: 'setDimension',
        dimensionId: 'dOrd',
        patch: { kind: 'radius' },
      })
    ).toThrow(CommandError);
  });

  it('refuses invalid kind values', () => {
    const dia: Dimension = {
      id: 'dim1',
      view: 'view1',
      kind: 'diameter',
      ref: ref('holeFace'),
      angle: 45,
    };
    const doc = applyDrawingCommand(base(), { type: 'insertDimensions', dimensions: [dia] });

    expect(() =>
      applyDrawingCommand(doc, {
        type: 'setDimension',
        dimensionId: 'dim1',
        patch: { kind: 'linear' as any },
      })
    ).toThrow(CommandError);
  });

  it('supports batch switching of multiple circular dimensions', () => {
    const dia1: Dimension = { id: 'd1', view: 'view1', kind: 'diameter', ref: ref('h1'), angle: 30 };
    const rad2: Dimension = { id: 'd2', view: 'view1', kind: 'radius', ref: ref('h2'), angle: 60 };
    let doc = applyDrawingCommand(base(), {
      type: 'insertDimensions',
      dimensions: [dia1, rad2],
    });

    // Batch toggle both to diameter
    doc = applyDrawingCommand(doc, {
      type: 'batch',
      commands: [
        { type: 'setDimension', dimensionId: 'd1', patch: { kind: 'diameter' } },
        { type: 'setDimension', dimensionId: 'd2', patch: { kind: 'diameter' } },
      ],
    });
    expect(page(doc).dimensions.every((d) => d.kind === 'diameter')).toBe(true);

    // Batch toggle both to radius
    doc = applyDrawingCommand(doc, {
      type: 'batch',
      commands: [
        { type: 'setDimension', dimensionId: 'd1', patch: { kind: 'radius' } },
        { type: 'setDimension', dimensionId: 'd2', patch: { kind: 'radius' } },
      ],
    });
    expect(page(doc).dimensions.every((d) => d.kind === 'radius')).toBe(true);
  });
});
