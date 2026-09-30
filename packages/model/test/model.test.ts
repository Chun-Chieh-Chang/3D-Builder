import { registerTranslation, setLocale } from '@3db/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyCommand,
  CommandError,
  createDemoPart,
  DocHistory,
  evalAngle,
  evalLength,
  FormatError,
  isShown,
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

describe('visibility (D4.6)', () => {
  it('has defaults: a used sketch is hidden, an unused one shown, default planes hidden, the origin shown', () => {
    const doc = createDemoPart();
    expect(isShown(doc, 'sketch1')).toBe(false); // extrude1 uses it
    expect(isShown({ ...doc, features: [doc.features[0]!] }, 'sketch1')).toBe(true);
    expect(isShown(doc, 'plane:front')).toBe(false);
    expect(isShown(doc, 'origin')).toBe(true);
  });
  it('stores only what the user chose, and a choice beats the default', () => {
    const doc = applyCommand(createDemoPart(), { type: 'setVisibility', keys: ['sketch1', 'plane:front', 'origin'], value: true });
    expect(doc.visibility).toEqual({ sketch1: true, 'plane:front': true, origin: true });
    expect(isShown(doc, 'sketch1')).toBe(true);
    const hidden = applyCommand(doc, { type: 'setVisibility', keys: ['origin'], value: false });
    expect(isShown(hidden, 'origin')).toBe(false);
  });
  it('rejects items that cannot be hidden and changes nothing', () => {
    const doc = createDemoPart();
    expect(() => applyCommand(doc, { type: 'setVisibility', keys: ['sketch1', 'extrude1'], value: true })).toThrow(CommandError);
    expect(() => applyCommand(doc, { type: 'setVisibility', keys: ['nope'], value: false })).toThrow(CommandError);
  });
  it('forgets the choice when its feature is deleted', () => {
    const shown = applyCommand(createDemoPart(), { type: 'setVisibility', keys: ['sketch1', 'origin'], value: true });
    const doc = applyCommand(shown, { type: 'deleteFeatures', featureIds: ['fillet1', 'extrude1', 'sketch1'] });
    expect(doc.visibility).toEqual({ origin: true });
  });
  it('is saved with the part and survives the round trip', () => {
    const doc = applyCommand(createDemoPart(), { type: 'setVisibility', keys: ['sketch1', 'plane:top'], value: true });
    expect(parsePart(serializePart(doc)).visibility).toEqual({ 'plane:top': true, sketch1: true });
  });
  it('a version-6 document opens with every item at its default', () => {
    const { visibility: _omit, ...v6 } = createDemoPart();
    const doc = parsePart(serializePart({ ...v6, schemaVersion: 6 } as never));
    expect(doc.schemaVersion).toBe(7);
    expect(doc.visibility).toEqual({});
  });
});

describe('replacing a reference (B4.3)', () => {
  const missing = { kind: 'edge', name: '{extrude1:cap:end|extrude1:side:sketch1.l2}' } as const;
  const other = { kind: 'edge', name: '{extrude1:cap:end|extrude1:side:sketch1.l3}', fingerprint: { type: 'line', size: 20, center: [10, 5, -10] as [number, number, number], dir: [1, 0, 0] as [number, number, number] } } as const;
  it('points a fillet edge at another edge, with its fingerprint, and nothing else changes', () => {
    const doc = createDemoPart();
    const next = applyCommand(doc, { type: 'replaceRef', featureId: 'fillet1', from: missing, to: other });
    const fillet = next.features[2]!;
    expect(fillet.type === 'fillet' && fillet.edges).toEqual([other]);
    expect(fillet).toMatchObject({ radius: '2', name: '圓角1' });
    expect(next.features.slice(0, 2)).toEqual(doc.features.slice(0, 2));
  });
  it('keeps one edge when the substitute is already selected', () => {
    let doc = createDemoPart();
    doc = applyCommand(doc, { type: 'setEdges', featureId: 'fillet1', edges: [missing, other] });
    const next = applyCommand(doc, { type: 'replaceRef', featureId: 'fillet1', from: missing, to: other });
    const fillet = next.features[2]!;
    expect(fillet.type === 'fillet' && fillet.edges).toEqual([other]);
  });
  it('refuses a reference the feature does not have, a different kind, and non-element references', () => {
    const doc = createDemoPart();
    expect(() => applyCommand(doc, { type: 'replaceRef', featureId: 'fillet1', from: { kind: 'edge', name: 'x' }, to: other })).toThrow(CommandError);
    expect(() => applyCommand(doc, { type: 'replaceRef', featureId: 'fillet1', from: missing, to: { kind: 'face', name: 'f' } })).toThrow(CommandError);
    expect(() => applyCommand(doc, { type: 'replaceRef', featureId: 'sketch1', from: { kind: 'datum', name: 'plane:top' }, to: { kind: 'datum', name: 'plane:front' } })).toThrow(CommandError);
    expect(() => applyCommand(doc, { type: 'replaceRef', featureId: 'nope', from: missing, to: other })).toThrow(CommandError);
  });
  it('replaces the face of a sketch plane and of an up-to-face end condition', () => {
    let doc = createDemoPart();
    const face = { kind: 'face', name: '{extrude1:cap:end}' } as const;
    const face2 = { kind: 'face', name: '{extrude1:cap:start}' } as const;
    doc = applyCommand(doc, { type: 'setEndCondition', featureId: 'extrude1', dir: 'dir1', value: { type: 'upToFace', face } });
    const next = applyCommand(doc, { type: 'replaceRef', featureId: 'extrude1', from: face, to: face2 });
    const e = next.features[1]!;
    expect(e.type === 'extrude' && e.dir1).toEqual({ type: 'upToFace', face: face2 });
  });
});

describe('messages follow the language (D9.1)', () => {
  afterEach(() => {
    setLocale('zh-TW');
    registerTranslation('en', {});
  });
  it('a refused command explains itself in the language in use', () => {
    const doc = createDemoPart();
    const rename = () => applyCommand(doc, { type: 'renameFeature', featureId: 'sketch1', name: ' ' });
    expect(rename).toThrow('名稱不可空白');
    registerTranslation('en', { 'cmd.nameEmpty': 'The name cannot be empty' });
    setLocale('en');
    expect(rename).toThrow('The name cannot be empty');
    expect(() => evalLength('abc')).toThrow('無法解析長度：「abc」'); // not translated yet: the source text
  });
});
