/**
 * Phase 3a-9b (B2.5, D1.5, D1.7, B1.4): the history in another order, notes, tags and folders on features, and part templates (ADR 0041).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createPartFromTemplate, PART_TEMPLATES, parsePart, serializePart, settingsOf, type Feature, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { orderProblem, Regenerator } from '@3db/regen';
import { build, circle, extrude, face, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const ids = (doc: PartDoc) => doc.features.map((f) => f.id);

/** Two separate posts on a plate: the plate (s1, e1), the first post (s2, e2), the second post (s3, e3). */
const posts = (): Feature[] => [
  sketch('s1', front, rectangle('p', 0, 0, 60, 20)),
  extrude('e1', 's1', 'boss', { type: 'blind', depth: '5' }),
  sketch('s2', face('e1:cap:end'), circle('k', 10, 10, 2)),
  extrude('e2', 's2', 'boss', { type: 'blind', depth: '5' }),
  sketch('s3', face('e1:cap:end'), circle('m', 40, 10, 2)),
  extrude('e3', 's3', 'boss', { type: 'blind', depth: '5' }),
];

describe('the history in another order (B2.5)', () => {
  it('two features that do not depend on each other change places, in one step, and the part is the same', () => {
    const doc = build(...posts());
    const order = ['s1', 'e1', 's3', 'e3', 's2', 'e2'];
    expect(orderProblem(doc, order)).toBeNull();
    const moved = applyCommand(doc, { type: 'arrange', order });
    expect(ids(moved)).toEqual(order);
    const [a, b] = [rebuild(doc), rebuild(moved)];
    expect(statuses(b).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(kernel.massProps(b.body!.shape).volume).toBeCloseTo(kernel.massProps(a.body!.shape).volume, 9);
  });

  it('a feature cannot come before what it is built on', () => {
    const doc = build(...posts());
    expect(orderProblem(doc, ['e2', 's1', 'e1', 's2', 's3', 'e3'])).toEqual({ feature: 'e2', parent: 's2' });
    // a sketch on the plate's face is built on the plate
    expect(orderProblem(doc, ['s1', 's2', 'e1', 'e2', 's3', 'e3'])).toEqual({ feature: 's2', parent: 'e1' });
  });

  it('the command takes every feature once and does not cross the rollback bar', () => {
    const doc = build(...posts());
    expect(() => applyCommand(doc, { type: 'arrange', order: ['s1', 'e1'] })).toThrow('每個特徵恰好放一次');
    expect(() => applyCommand(doc, { type: 'arrange', order: ['s1', 's1', 'e1', 's2', 'e2', 's3'] })).toThrow('每個特徵恰好放一次');
    const rolled = applyCommand(doc, { type: 'setRollback', index: 4 });
    expect(() => applyCommand(rolled, { type: 'arrange', order: ['s1', 'e1', 's2', 's3', 'e2', 'e3'] })).toThrow('回溯控制棒');
    // what is after the bar can be put in another order among itself
    expect(ids(applyCommand(rolled, { type: 'arrange', order: ['s1', 'e1', 's2', 'e2', 'e3', 's3'] }))).toEqual(['s1', 'e1', 's2', 'e2', 'e3', 's3']);
  });

  it('an order that breaks a dependency is reported by the rebuild, not hidden', () => {
    const wrong = applyCommand(build(...posts()), { type: 'arrange', order: ['s1', 's2', 'e1', 'e2', 's3', 'e3'] });
    expect(rebuild(wrong).features.find((f) => f.id === 's2')?.status).toBe('error');
  });

  it('it can be undone as one step', async () => {
    const { DocHistory } = await import('@3db/model');
    const history = new DocHistory(build(...posts()));
    history.execute({ type: 'arrange', order: ['s1', 'e1', 's3', 'e3', 's2', 'e2'] });
    expect(ids(history.doc)).toEqual(['s1', 'e1', 's3', 'e3', 's2', 'e2']);
    history.undo();
    expect(ids(history.doc)).toEqual(['s1', 'e1', 's2', 'e2', 's3', 'e3']);
  });
});

describe('folders, notes and tags (D1.7)', () => {
  it('features are put in a folder together and the folder is kept in the file', () => {
    let doc = build(...posts());
    doc = applyCommand(doc, { type: 'arrange', order: ids(doc), folders: { s2: '柱子', e2: '柱子' } });
    expect(doc.features.filter((f) => f.folder === '柱子').map((f) => f.id)).toEqual(['s2', 'e2']);
    expect(parsePart(serializePart(doc)).features.filter((f) => f.folder).map((f) => f.id)).toEqual(['s2', 'e2']);
    const out = applyCommand(doc, { type: 'arrange', order: ids(doc), folders: { s2: null, e2: null } });
    expect(out.features.some((f) => f.folder)).toBe(false);
  });

  it('the features of a folder have to follow one another', () => {
    const doc = build(...posts());
    expect(() => applyCommand(doc, { type: 'arrange', order: ids(doc), folders: { s1: 'A', e2: 'A' } })).toThrow('一個接著一個');
    expect(() => applyCommand(doc, { type: 'arrange', order: ids(doc), folders: { nope: 'A' } })).toThrow('找不到特徵');
  });

  it('a note and a tag are set, replaced and taken away; they do not change the part', () => {
    let doc = build(...posts());
    doc = applyCommand(doc, { type: 'setFeatureNote', featureId: 'e2', comment: '定位用', tag: ' 加工 ' });
    expect(doc.features.find((f) => f.id === 'e2')).toMatchObject({ comment: '定位用', tag: '加工' });
    expect(parsePart(serializePart(doc)).features.find((f) => f.id === 'e2')).toMatchObject({ comment: '定位用', tag: '加工' });
    expect(kernel.massProps(rebuild(doc).body!.shape).volume).toBeCloseTo(kernel.massProps(rebuild(build(...posts())).body!.shape).volume, 9);
    doc = applyCommand(doc, { type: 'setFeatureNote', featureId: 'e2', tag: '' });
    expect(doc.features.find((f) => f.id === 'e2')).toMatchObject({ comment: '定位用' });
    expect(doc.features.find((f) => f.id === 'e2')?.tag).toBeUndefined();
    expect(() => applyCommand(doc, { type: 'setFeatureNote', featureId: 'zzz', comment: 'x' })).toThrow();
  });

  it('a feature is renamed (the command that was waiting for an interface)', () => {
    const doc = applyCommand(build(...posts()), { type: 'renameFeature', featureId: 'e2', name: '左柱' });
    expect(doc.features.find((f) => f.id === 'e2')?.name).toBe('左柱');
    expect(() => applyCommand(doc, { type: 'renameFeature', featureId: 'e2', name: '  ' })).toThrow();
  });
});

describe('part templates (B1.4)', () => {
  it('every template makes an empty part of the current version with its material and settings', () => {
    for (const t of PART_TEMPLATES) {
      const doc = createPartFromTemplate(t.id);
      expect(doc.features).toEqual([]);
      expect(doc.material !== undefined).toBe(t.material !== null);
    }
    expect(createPartFromTemplate('blank').material).toBeUndefined();
    expect(createPartFromTemplate('steel').material).toMatchObject({ id: 'steel', name: '碳鋼', density: 7.85 });
    expect(createPartFromTemplate('aluminium').material).toMatchObject({ id: 'aluminium6061', density: 2.7 });
    expect(settingsOf(createPartFromTemplate('plastic'))).toMatchObject({ meshQuality: 'fine' });
    expect(createPartFromTemplate('plastic').material).toMatchObject({ id: 'abs' });
    expect(settingsOf(createPartFromTemplate('cns'))).toEqual({ draftStandard: 'CNS', dimensionPrecision: 2, meshQuality: 'normal' });
  });

  it('a part made from a template is a part like any other: it saves, reads back and takes features', () => {
    const doc = createPartFromTemplate('cns');
    expect(parsePart(serializePart(doc)).material).toEqual(doc.material);
    const built = applyCommand(doc, { type: 'insertFeature', index: 0, feature: sketch('s1', front, rectangle('p', 0, 0, 10, 10)) });
    expect(built.settings).toEqual(doc.settings);
  });
});
