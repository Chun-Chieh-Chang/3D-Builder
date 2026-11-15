/**
 * ADR 0254: two features never share a name, and a feature or a variable can be marked as holding estimates. Ground truth is the document itself: what is
 * stored, what an expression finds by a sketch's name, and what a file written and read again holds.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, CommandError, createEmptyPart, dimensionName, freeFeatureName, Parameters, parsePart, serializePart, SCHEMA_VERSION, type Feature, type PartDoc } from '../src/index';

const front = { kind: 'datum' as const, name: 'plane:front' };
const sketch = (id: string, name: string, value = '10'): Feature => ({
  id,
  name,
  type: 'sketch',
  suppressed: false,
  plane: front,
  entities: [{ id: `${id}c`, type: 'point', x: 0, y: 0 }, { id: `${id}k`, type: 'circle', center: `${id}c`, radius: 5 }],
  constraints: [{ id: `${id}d`, type: 'radius', circle: `${id}k`, value }],
});
const insert = (doc: PartDoc, feature: Feature) => applyCommand(doc, { type: 'insertFeature', feature, index: doc.features.length });

describe('feature names are unique (ADR 0254)', () => {
  it('refuses an insert whose name another feature has, offers the next free one, and leaves the document as it was', () => {
    const doc = insert(createEmptyPart(), sketch('s1', '開口槽'));
    expect(() => insert(doc, sketch('s2', '開口槽'))).toThrow(CommandError);
    expect(() => insert(doc, sketch('s2', '開口槽'))).toThrow('「開口槽2」');
    // the same name with spaces around it reads the same in the tree
    expect(() => insert(doc, sketch('s2', ' 開口槽 '))).toThrow('開口槽');
    expect(doc.features.map((f) => f.name)).toEqual(['開口槽']);
    expect(insert(doc, sketch('s2', '開口槽2')).features.map((f) => f.name)).toEqual(['開口槽', '開口槽2']);
  });

  it('refuses an empty or blank name on insert as it already did on rename', () => {
    expect(() => insert(createEmptyPart(), sketch('s1', ''))).toThrow(CommandError);
    expect(() => insert(createEmptyPart(), sketch('s1', '   '))).toThrow(CommandError);
  });

  it('refuses a rename onto another feature’s name, but a feature may keep its own name', () => {
    let doc = insert(insert(createEmptyPart(), sketch('s1', 'A')), sketch('s2', 'B'));
    expect(() => applyCommand(doc, { type: 'renameFeature', featureId: 's2', name: 'A' })).toThrow('「A2」');
    expect(() => applyCommand(doc, { type: 'renameFeature', featureId: 's2', name: ' A ' })).toThrow(CommandError);
    doc = applyCommand(doc, { type: 'renameFeature', featureId: 's1', name: 'A' });
    expect(doc.features.map((f) => f.name)).toEqual(['A', 'B']);
  });

  it('numbers past every taken name the way SolidWorks numbers features', () => {
    const doc = { features: ['Cut', 'Cut2', 'Cut3', '伸長1', '伸長2', 'x9', 'Cut9007199254740991'].map((name, i) => sketch(`s${i}`, name)) };
    expect(freeFeatureName(doc, 'Cut')).toBe('Cut4');
    expect(freeFeatureName(doc, 'Cut2')).toBe('Cut4');
    expect(freeFeatureName(doc, '伸長1')).toBe('伸長3');
    expect(freeFeatureName(doc, 'x9')).toBe('x10');
    expect(freeFeatureName(doc, 'Cut9007199254740991')).toBe('Cut9007199254740992');
    const next = { features: [...doc.features, sketch('large', 'Cut9007199254740992')] };
    expect(freeFeatureName(next, 'Cut9007199254740992')).toBe('Cut9007199254740993');
    expect(freeFeatureName(doc, 'free')).toBe('free');
    // the feature being renamed does not count against itself
    expect(freeFeatureName(doc, 'Cut', 's0')).toBe('Cut');
  });

  it('keeps a dimension found by its sketch’s name: with names unique the owner is never ambiguous', () => {
    let doc = insert(createEmptyPart(), sketch('s1', 'P', '7'));
    const d = dimensionName((doc.features[0] as Extract<Feature, { type: 'sketch' }>).constraints[0]!);
    doc = applyCommand(doc, { type: 'addVariable', variable: { id: 'v1', name: 'R', expr: `${d}@P * 2` } });
    expect(() => insert(doc, sketch('s2', 'P', '3'))).toThrow(CommandError);
    // what the variable reads is still the first sketch's dimension
    const r = new Parameters(doc).variableValue(doc.variables[0]!);
    expect('value' in r && r.value.v).toBe(14);
  });

  it('opens an older file that has two features of one name: nothing is renamed behind the user', () => {
    const a = sketch('s1', 'same'), b = sketch('s2', 'same');
    const old = { ...createEmptyPart(), schemaVersion: 95, features: [a, b], idCounters: { s: 2 } };
    const doc = parsePart(JSON.stringify(old));
    expect(doc.features.map((f) => f.name)).toEqual(['same', 'same']);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('the estimate mark (ADR 0254)', () => {
  it('is set, kept through a file, and cleared on a feature', () => {
    let doc = insert(createEmptyPart(), sketch('s1', 'Groove'));
    doc = applyCommand(doc, { type: 'setFeatureNote', featureId: 's1', estimate: true });
    expect(doc.features[0]!.estimate).toBe(true);
    // the comment and tag are left as they were
    expect(doc.features[0]!.comment).toBeUndefined();
    const read = parsePart(serializePart(doc));
    expect(read.features[0]!.estimate).toBe(true);
    doc = applyCommand(doc, { type: 'setFeatureNote', featureId: 's1', estimate: false });
    expect('estimate' in doc.features[0]!).toBe(false);
  });

  it('is set and cleared on a variable without touching its value', () => {
    let doc = applyCommand(createEmptyPart(), { type: 'addVariable', variable: { id: 'v1', name: 'Lead', expr: '25', estimate: true } });
    expect(doc.variables[0]).toEqual({ id: 'v1', name: 'Lead', expr: '25', estimate: true });
    doc = applyCommand(doc, { type: 'setVariable', id: 'v1', estimate: false });
    expect(doc.variables[0]).toEqual({ id: 'v1', name: 'Lead', expr: '25' });
    doc = applyCommand(doc, { type: 'setVariable', id: 'v1', expr: '39', estimate: true });
    expect(parsePart(serializePart(doc)).variables[0]).toEqual({ id: 'v1', name: 'Lead', expr: '39', estimate: true });
  });

  it('refuses a mark that is not true or false instead of guessing what was meant', () => {
    const doc = insert(createEmptyPart(), sketch('s1', 'A'));
    for (const bad of ['yes', 1, 0, null, 'true'] as unknown[]) {
      expect(() => applyCommand(doc, { type: 'setFeatureNote', featureId: 's1', estimate: bad as boolean })).toThrow(CommandError);
      expect(() => applyCommand(createEmptyPart(), { type: 'addVariable', variable: { id: 'v1', name: 'A', expr: '1', estimate: bad as true } })).toThrow(CommandError);
    }
    expect(() => insert(createEmptyPart(), { ...sketch('s1', 'A'), estimate: false as unknown as true })).toThrow(CommandError);
  });

  it('is written as version 96, which an older program refuses rather than drop the mark', () => {
    const doc = applyCommand(insert(createEmptyPart(), sketch('s1', 'A')), { type: 'setFeatureNote', featureId: 's1', estimate: true });
    const version = JSON.parse(serializePart(doc)).schemaVersion;
    expect(version).toBe(SCHEMA_VERSION);
    expect(version).toBeGreaterThanOrEqual(96);
  });
});
