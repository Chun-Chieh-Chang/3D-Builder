import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  CommandError,
  createDemoPart,
  DocHistory,
  evalAngle,
  evalLength,
  FormatError,
  parsePart,
  serializePart,
  type SketchFeature,
} from '../src/index';

const width = (doc: ReturnType<typeof createDemoPart>) =>
  (doc.features[0] as SketchFeature).constraints.find((c) => c.id === 'd1');

describe('expressions', () => {
  it('converts lengths to mm and angles to radians', () => {
    expect(evalLength('20')).toBe(20);
    expect(evalLength('1in')).toBeCloseTo(25.4);
    expect(evalLength(' 2.5 cm ')).toBeCloseTo(25);
    expect(evalAngle('90')).toBeCloseTo(Math.PI / 2);
    expect(evalAngle('1rad')).toBe(1);
  });
  it('rejects malformed values and unknown units', () => {
    expect(() => evalLength('abc')).toThrow();
    expect(() => evalLength('10 furlong')).toThrow();
  });
});

describe('commands', () => {
  it('changes a dimension without mutating the input document', () => {
    const doc = createDemoPart();
    const next = applyCommand(doc, { type: 'setDimension', featureId: 'sketch1', constraintId: 'd1', value: '30' });
    expect(width(next)).toMatchObject({ value: '30' });
    expect(width(doc)).toMatchObject({ value: '20' });
  });
  it('rejects invalid values and leaves the document unchanged', () => {
    const h = new DocHistory(createDemoPart());
    const before = h.doc;
    expect(() => h.execute({ type: 'setDimension', featureId: 'sketch1', constraintId: 'd1', value: '-3' })).toThrow(CommandError);
    expect(() => h.execute({ type: 'setFilletRadius', featureId: 'fillet1', value: 'x' })).toThrow(CommandError);
    expect(h.doc).toBe(before);
  });
});

describe('history', () => {
  it('undoes and redoes', () => {
    const h = new DocHistory(createDemoPart());
    h.execute({ type: 'setDimension', featureId: 'sketch1', constraintId: 'd1', value: '30' });
    h.execute({ type: 'setFilletRadius', featureId: 'fillet1', value: '3' });
    h.undo();
    expect(h.doc.features[2]).toMatchObject({ radius: '2' });
    h.undo();
    expect(width(h.doc)).toMatchObject({ value: '20' });
    h.redo();
    expect(width(h.doc)).toMatchObject({ value: '30' });
  });
  it('commits an edit session as one undo step and rolls back on cancel', () => {
    const h = new DocHistory(createDemoPart());
    h.begin('edit sketch');
    h.execute({ type: 'setDimension', featureId: 'sketch1', constraintId: 'd1', value: '25' });
    h.execute({ type: 'setDimension', featureId: 'sketch1', constraintId: 'd2', value: '12' });
    h.commit();
    h.undo();
    expect(width(h.doc)).toMatchObject({ value: '20' });

    const original = h.doc;
    h.begin('edit fillet');
    h.execute({ type: 'setFilletRadius', featureId: 'fillet1', value: '4' });
    h.rollback();
    expect(h.doc).toEqual(original);
  });
});

describe('serialization', () => {
  it('is canonical and round-trips', () => {
    const doc = createDemoPart();
    const text = serializePart(doc);
    expect(serializePart(parsePart(text))).toBe(text);
    expect(parsePart(text)).toEqual(doc);
  });
  it('refuses newer schema versions', () => {
    const text = serializePart({ ...createDemoPart(), schemaVersion: 99 });
    expect(() => parsePart(text)).toThrow(FormatError);
  });
});
