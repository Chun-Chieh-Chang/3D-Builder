import { en, registerTranslation, setLocale } from '@3db/i18n';
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
  Parameters,
  SCHEMA_VERSION,
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
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION); // migrated all the way to the current version
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
    registerTranslation('en', en);
  });
  it('a refused command explains itself in the language in use', () => {
    const doc = createDemoPart();
    const rename = () => applyCommand(doc, { type: 'renameFeature', featureId: 'sketch1', name: ' ' });
    expect(rename).toThrow('名稱不可空白');
    setLocale('en');
    expect(rename).toThrow('The name cannot be empty');
    expect(() => evalLength('abc')).toThrow('Variable "abc" not found');
    registerTranslation('en', { 'expr.unknownVariable': undefined }); // a text a language lacks is the source text
    expect(() => evalLength('abc')).toThrow('找不到變數「abc」');
  });
});

describe('variables, properties and names (B5.2, B5.3, B8.3)', () => {
  const withVars = () =>
    [
      { type: 'addVariable', variable: { id: 'var1', name: 'w', expr: '15' } },
      { type: 'addVariable', variable: { id: 'var2', name: 'k', expr: 'w * 2' } },
    ].reduce((doc, cmd) => applyCommand(doc, cmd as never), createDemoPart());

  it('adds variables, and refuses a bad name, a taken name and an expression that cannot be evaluated', () => {
    const doc = withVars();
    expect(doc.variables.map((v) => v.name)).toEqual(['w', 'k']);
    expect(doc.idCounters.var).toBe(2);
    expect(() => applyCommand(doc, { type: 'addVariable', variable: { id: 'var3', name: '2x', expr: '1' } })).toThrow(CommandError);
    expect(() => applyCommand(doc, { type: 'addVariable', variable: { id: 'var3', name: 'w', expr: '1' } })).toThrow('已經有名稱是「w」的變數');
    expect(() => applyCommand(doc, { type: 'addVariable', variable: { id: 'var3', name: 'z', expr: 'nope + 1' } })).toThrow('找不到變數「nope」');
    expect(() => applyCommand(doc, { type: 'addVariable', variable: { id: 'var1', name: 'z', expr: '1' } })).toThrow(CommandError); // id in use
  });

  it('a dimension, a depth, a radius and a variable can all be expressions', () => {
    let doc = withVars();
    doc = applyCommand(doc, { type: 'setDimension', featureId: 'sketch1', constraintId: 'd1', value: 'k + 3' });
    doc = applyCommand(doc, { type: 'setEndCondition', featureId: 'extrude1', dir: 'dir1', value: { type: 'blind', depth: 'w / 3' } });
    doc = applyCommand(doc, { type: 'setFilletRadius', featureId: 'fillet1', value: 'w / 10' });
    expect(new Parameters(doc).evaluate('k + 3', 'length')).toBe(33);
    expect(() => applyCommand(doc, { type: 'setFilletRadius', featureId: 'fillet1', value: '0 * w' })).toThrow('數值必須大於 0');
    expect(() => applyCommand(doc, { type: 'setDimension', featureId: 'sketch1', constraintId: 'd1', value: 'nope' })).toThrow('找不到變數「nope」');
    expect(() => applyCommand(doc, { type: 'setDimension', featureId: 'sketch1', constraintId: 'd1', value: '30deg' })).toThrow('需要長度');
  });

  it('refuses an expression that would make a cycle, naming the path', () => {
    const doc = withVars();
    expect(() => applyCommand(doc, { type: 'setVariable', id: 'var1', expr: 'k + 1' })).toThrow('循環引用：w → k → w');
    const d = applyCommand(doc, { type: 'setDimension', featureId: 'sketch1', constraintId: 'd1', value: '高度@草圖1' });
    expect(() => applyCommand(d, { type: 'setDimension', featureId: 'sketch1', constraintId: 'd2', value: '寬度@草圖1' })).toThrow('循環引用');
  });

  it('renaming a variable, a sketch or a dimension keeps every expression that used it working', () => {
    let doc = withVars();
    doc = applyCommand(doc, { type: 'setDimension', featureId: 'sketch1', constraintId: 'd2', value: 'w' });
    doc = applyCommand(doc, { type: 'setVariable', id: 'var1', name: 'half' });
    expect(doc.variables.map((v) => v.expr)).toEqual(['15', 'half * 2']);
    expect((doc.features[0] as SketchFeature).constraints.find((c) => c.id === 'd2')).toMatchObject({ value: 'half' });
    doc = applyCommand(doc, { type: 'addVariable', variable: { id: 'var3', name: 'h', expr: '高度@草圖1 + 1' } });
    doc = applyCommand(doc, { type: 'renameFeature', featureId: 'sketch1', name: '底板' });
    expect(doc.variables[2]!.expr).toBe('高度@底板 + 1');
    doc = applyCommand(doc, { type: 'setDimensionLabel', featureId: 'sketch1', constraintId: 'd2', label: 'depth_y' });
    expect(doc.variables[2]!.expr).toBe('depth_y@底板 + 1');
    expect(new Parameters(doc).variableValue(doc.variables[2]!)).toMatchObject({ value: { v: 16 } });
    doc = applyCommand(doc, { type: 'setDimensionLabel', featureId: 'sketch1', constraintId: 'd2', label: '' });
    expect(doc.variables[2]!.expr).toBe('D2@底板 + 1');
  });

  it('refuses a name a sketch already has, and a name that cannot be written bare', () => {
    const doc = createDemoPart();
    expect(() => applyCommand(doc, { type: 'setDimensionLabel', featureId: 'sketch1', constraintId: 'd2', label: '寬度' })).toThrow('已經有名稱是「寬度」的尺寸');
    expect(() => applyCommand(doc, { type: 'setDimensionLabel', featureId: 'sketch1', constraintId: 'd2', label: 'a b' })).toThrow(CommandError);
  });

  it('will not delete a variable that is still used, and lists who uses it', () => {
    const doc = withVars();
    expect(() => applyCommand(doc, { type: 'deleteVariable', id: 'var1' })).toThrow('變數「w」正被使用');
    expect(applyCommand(doc, { type: 'deleteVariable', id: 'var2' }).variables.map((v) => v.name)).toEqual(['w']);
    expect(() => applyCommand(doc, { type: 'deleteVariable', id: 'nope' })).toThrow(CommandError);
  });

  it('keeps file properties, and an expression can read them', () => {
    let doc = applyCommand(createDemoPart(), { type: 'setProperty', name: '板厚', value: '4mm' });
    doc = applyCommand(doc, { type: 'setProperty', name: '廠商', value: '某某' });
    doc = applyCommand(doc, { type: 'setDimension', featureId: 'sketch1', constraintId: 'd2', value: "property('板厚') * 3" });
    expect(new Parameters(doc).evaluate("property('板厚') * 3", 'length')).toBe(12);
    expect(applyCommand(doc, { type: 'deleteProperty', name: '廠商' }).properties['廠商']).toBeUndefined();
    expect(() => applyCommand(doc, { type: 'setProperty', name: '  ', value: 'x' })).toThrow(CommandError);
    expect(() => applyCommand(doc, { type: 'deleteProperty', name: '沒有' })).toThrow(CommandError);
    expect(() => applyCommand(doc, { type: 'setDimension', featureId: 'sketch1', constraintId: 'd2', value: "property('沒有')" })).toThrow('找不到檔案屬性');
  });

  it('is saved and read back', () => {
    const doc = applyCommand(withVars(), { type: 'setProperty', name: '料號', value: 'A-1' });
    expect(parsePart(serializePart(doc))).toEqual(doc);
  });
});
