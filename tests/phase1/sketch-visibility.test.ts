/**
 * A sketch a feature is built from is hidden by default (as in SolidWorks), for every feature that takes a sketch: the first
 * version listed only extrude, revolve, sweep, loft, rib and thread, so the base flange of a sheet metal bracket left its profile
 * drawn on the model (2026-10-21, reported with a screenshot). A sketch used only through a reference stays shown.
 */
import { describe, expect, it } from 'vitest';
import { absorbedSketches, isShown, shownByDefault, type Feature, type PartDoc } from '@3db/model';
import { build, front, rectangle, sketch } from './builders';

const base = { suppressed: false } as const;
/** Each feature type that holds a sketch id, with the fields that hold it. */
const takers: Record<string, Record<string, unknown>> = {
  extrude: { sketch: 'sk' },
  revolve: { sketch: 'sk' },
  hole: { sketch: 'sk' },
  rib: { sketch: 'sk' },
  vent: { sketch: 'sk' },
  splitLine: { sketch: 'sk' },
  trimSurface: { sketch: 'sk' },
  screwBoss: { sketch: 'sk' },
  baseFlange: { sketch: 'sk' },
  midBend: { sketch: 'sk' },
  jog: { sketch: 'sk' },
  snapHook: { sketch: 'sk' },
  snapCatch: { sketch: 'sk' },
  thread: { sketch: 'sk' },
  sweep: { sketch: 'other', path: 'sk' },
  loft: { sections: ['other', 'sk'] },
};

describe('a sketch a feature is built from is hidden by default', () => {
  it('the sheet metal bracket: the profile of a base flange is hidden', () => {
    const flange = { ...base, id: 'bf', type: 'baseFlange', name: 'bf', sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5', depth: '40' } as Feature;
    const doc = build(sketch('sk', front, rectangle('r', 0, 0, 60, 40)) as Feature, flange);
    expect(isShown(doc, 'sk')).toBe(false);
    expect(absorbedSketches(flange)).toEqual(['sk']);
  });

  it.each(Object.entries(takers))('%s', (type, fields) => {
    const f = { ...base, id: 'f', name: 'f', type, ...fields } as unknown as Feature;
    const doc = { features: [{ id: 'sk', type: 'sketch' }, { id: 'other', type: 'sketch' }, f], visibility: {} } as unknown as PartDoc;
    expect(absorbedSketches(f)).toContain('sk');
    expect(shownByDefault(doc, 'sk')).toBe(false);
  });

  it('a thread with no sketch of its own (the standard profile) absorbs nothing', () => {
    expect(absorbedSketches({ ...base, id: 't', name: 't', type: 'thread' } as unknown as Feature)).toEqual([]);
  });
});

describe('a sketch used only through a reference stays shown', () => {
  it('a plane normal to one of its lines, a sketch following it, a helix on its circle', () => {
    const doc = {
      features: [
        { id: 'sk', type: 'sketch' },
        { ...base, id: 'pl', name: 'pl', type: 'refPlane', definition: { kind: 'normalToCurve', curve: { kind: 'sketch', name: 'sk:l1' } } },
        { id: 'sk2', type: 'sketch', entities: [{ id: 'l', type: 'line', ref: { kind: 'sketch', name: 'sk:l1' } }] },
        { ...base, id: 'hx', name: 'hx', type: 'helix', circle: { kind: 'sketch', name: 'sk:c1' } },
      ],
      visibility: {},
    } as unknown as PartDoc;
    expect(shownByDefault(doc, 'sk')).toBe(true);
    expect(doc.features.flatMap(absorbedSketches)).toEqual([]);
  });

  it('what the user chose wins either way', () => {
    const flange = { ...base, id: 'bf', type: 'baseFlange', name: 'bf', sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5', depth: '40' } as Feature;
    const doc = build(sketch('sk', front, rectangle('r', 0, 0, 60, 40)) as Feature, flange);
    expect(isShown({ ...doc, visibility: { sk: true } }, 'sk')).toBe(true);
    expect(isShown({ ...doc, visibility: { sk: false } }, 'sk')).toBe(false);
  });
});
