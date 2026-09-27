import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  CommandError,
  createDemoPart,
  createEmptyPart,
  DocHistory,
  IdAllocator,
  idsInUse,
  parsePart,
  SCHEMA_VERSION,
  type Command,
  type PartDoc,
  type SketchFeature,
} from '../src/index';

const sketch = (doc: PartDoc, id = 'sketch1') => doc.features.find((f) => f.id === id) as SketchFeature;
const apply = (doc: PartDoc, ...cmds: Command[]) => cmds.reduce(applyCommand, doc);

/** A line from (30,0) to (40,0) that starts at an existing corner of the demo rectangle. */
const addLine: Command = {
  type: 'addSketchItems',
  featureId: 'sketch1',
  entities: [
    { id: 'p5', type: 'point', x: 40, y: 0 },
    { id: 'l5', type: 'line', p1: 'p2', p2: 'p5' },
  ],
  constraints: [{ id: 'c6', type: 'horizontal', a: 'l5' }],
};

describe('ids', () => {
  it('issues readable ids above the counters and above every id in use', () => {
    const doc = createDemoPart();
    const alloc = new IdAllocator(doc.idCounters, idsInUse(doc));
    expect([alloc.take('l'), alloc.take('l'), alloc.take('sketch'), alloc.take('ci')]).toEqual(['l5', 'l6', 'sketch2', 'ci1']);
  });

  it('never hands out a deleted id again', () => {
    const doc = apply(createDemoPart(), { type: 'removeSketchItems', featureId: 'sketch1', ids: ['l4'] });
    expect(sketch(doc).entities.some((e) => e.id === 'l4')).toBe(false);
    expect(new IdAllocator(doc.idCounters, idsInUse(doc)).take('l')).toBe('l5');
  });
});

describe('insertFeature', () => {
  const newSketch = (id: string): Command => ({
    type: 'insertFeature',
    index: 3,
    feature: { id, type: 'sketch', name: '草圖2', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] },
  });

  it('inserts at the rollback bar and moves the bar below the new feature', () => {
    const rolled = apply(createDemoPart(), { type: 'setRollback', index: 2 });
    const doc = apply(rolled, { ...newSketch('sketch2'), index: 2 } as Command);
    expect(doc.features.map((f) => f.id)).toEqual(['sketch1', 'extrude1', 'sketch2', 'fillet1']);
    expect(doc.rollbackIndex).toBe(3);
    expect(doc.idCounters.sketch).toBe(2);
  });

  it('refuses ids in use, positions below the bar and extrudes before their sketch', () => {
    expect(() => apply(createDemoPart(), newSketch('extrude1'))).toThrow(CommandError);
    expect(() => apply(apply(createDemoPart(), { type: 'setRollback', index: 1 }), newSketch('sketch2'))).toThrow('插入位置');
    const extrude: Command = {
      type: 'insertFeature',
      index: 0,
      feature: { id: 'extrude2', type: 'extrude', name: '伸長2', suppressed: false, sketch: 'sketch1', op: 'boss', dir1: { type: 'blind', depth: '5' } },
    };
    expect(() => apply(createDemoPart(), extrude)).toThrow('之前的草圖');
  });
});

describe('sketch editing commands', () => {
  it('adds geometry with its relations and records the issued ids', () => {
    const doc = apply(createDemoPart(), addLine);
    expect(sketch(doc).entities.map((e) => e.id)).toContain('l5');
    expect(doc.idCounters).toMatchObject({ p: 5, l: 5, c: 6 });
  });

  it('rejects references to missing entities, wrong kinds and duplicate ids', () => {
    const bad = (constraints: unknown[]): Command => ({ type: 'addSketchItems', featureId: 'sketch1', entities: [], constraints } as Command);
    expect(() => apply(createDemoPart(), bad([{ id: 'x1', type: 'horizontal', a: 'p1' }]))).toThrow('水平/垂直');
    expect(() => apply(createDemoPart(), bad([{ id: 'x1', type: 'tangent', a: 'l1', b: 'l2' }]))).toThrow('相切');
    expect(() => apply(createDemoPart(), bad([{ id: 'x1', type: 'parallel', a: 'l1', b: 'l9' }]))).toThrow('不能套用');
    expect(() => apply(createDemoPart(), bad([{ id: 'l1', type: 'parallel', a: 'l1', b: 'l3' }]))).toThrow('ID 已被使用');
    expect(() => apply(createDemoPart(), bad([{ id: 'x1', type: 'radius', circle: 'l1', value: '3' }]))).toThrow('不能套用');
    expect(() => apply(createDemoPart(), bad([{ id: 'x1', type: 'distance', a: 'p1', b: 'p3', value: '-2' }]))).toThrow('大於 0');
  });

  it('accepts horizontal between two points', () => {
    const doc = apply(createDemoPart(), {
      type: 'addSketchItems',
      featureId: 'sketch1',
      entities: [{ id: 'p5', type: 'point', x: 5, y: 5 }],
      constraints: [{ id: 'c6', type: 'horizontal', a: 'p5', b: '@origin' }],
    });
    expect(sketch(doc).constraints.at(-1)).toMatchObject({ type: 'horizontal', a: 'p5', b: '@origin' });
  });

  it('deletes a line with its own endpoints and relations but keeps shared points', () => {
    const doc = apply(createDemoPart(), addLine, { type: 'removeSketchItems', featureId: 'sketch1', ids: ['l5'] });
    const ids = sketch(doc).entities.map((e) => e.id);
    expect(ids).not.toContain('p5'); // only l5 used it
    expect(ids).toContain('p2'); // shared with the rectangle
    expect(sketch(doc).constraints.map((c) => c.id)).not.toContain('c6');
  });

  it('deleting a point deletes the curves built on it and the relations that referred to them', () => {
    const doc = apply(createDemoPart(), { type: 'removeSketchItems', featureId: 'sketch1', ids: ['p3'] });
    const s = sketch(doc);
    expect(s.entities.map((e) => e.id).sort()).toEqual(['l1', 'l4', 'p1', 'p2', 'p4']);
    expect(s.constraints.map((c) => c.id)).toEqual(['c1', 'c2', 'c5', 'd1']);
  });

  it('stores placement and construction state', () => {
    const doc = apply(
      createDemoPart(),
      { type: 'setSketchGeometry', featureId: 'sketch1', points: [{ id: 'p3', x: 21, y: 11 }] },
      { type: 'setConstruction', featureId: 'sketch1', ids: ['l1'], value: true },
    );
    expect(sketch(doc).entities.find((e) => e.id === 'p3')).toMatchObject({ x: 21, y: 11 });
    expect(sketch(doc).entities.find((e) => e.id === 'l1')).toMatchObject({ construction: true });
    expect(() => apply(doc, { type: 'setConstruction', featureId: 'sketch1', ids: ['p1'], value: true })).toThrow(CommandError);
  });
});

describe('edit-session undo', () => {
  it('undoes and redoes inside a session, then commits it as one step', () => {
    const h = new DocHistory(createDemoPart());
    h.begin('edit sketch');
    h.execute(addLine);
    h.execute({ type: 'setConstruction', featureId: 'sketch1', ids: ['l5'], value: true });
    expect(h.canUndo).toBe(true);
    h.undo();
    expect(sketch(h.doc).entities.find((e) => e.id === 'l5')).not.toHaveProperty('construction');
    h.redo();
    expect(sketch(h.doc).entities.find((e) => e.id === 'l5')).toMatchObject({ construction: true });
    h.commit();
    h.undo();
    expect(sketch(h.doc).entities.some((e) => e.id === 'l5')).toBe(false);
    h.redo();
    expect(sketch(h.doc).entities.find((e) => e.id === 'l5')).toMatchObject({ construction: true });
  });

  it('cancel restores the document even after undo/redo inside the session', () => {
    const h = new DocHistory(createDemoPart());
    const before = h.doc;
    h.begin('edit sketch');
    h.execute(addLine);
    h.undo();
    h.execute({ type: 'removeSketchItems', featureId: 'sketch1', ids: ['l1'] });
    h.rollback();
    expect(h.doc).toEqual(before);
  });
});

describe('migration v1 → v2', () => {
  it('renames pointOnLine, moves horizontal/vertical to a/b and computes id counters', () => {
    const v1 = {
      ...createEmptyPart(),
      schemaVersion: 1,
      idCounters: undefined,
      features: [
        {
          id: 'sketch7',
          type: 'sketch',
          name: '草圖7',
          suppressed: false,
          plane: { kind: 'datum', name: 'plane:front' },
          entities: [
            { id: 'p1', type: 'point', x: 0, y: 0 },
            { id: 'p2', type: 'point', x: 10, y: 0 },
            { id: 'p3', type: 'point', x: 5, y: 0 },
            { id: 'l1', type: 'line', p1: 'p1', p2: 'p2' },
          ],
          constraints: [
            { id: 'c1', type: 'horizontal', line: 'l1' },
            { id: 'c2', type: 'pointOnLine', point: 'p3', line: 'l1' },
            { id: 'c3', type: 'midpoint', point: 'p3', line: 'l1' },
          ],
        },
      ],
    };
    const doc = parsePart(JSON.stringify(v1));
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION); // migrated all the way up
    expect(sketch(doc, 'sketch7').constraints).toEqual([
      { id: 'c1', type: 'horizontal', a: 'l1' },
      { id: 'c2', type: 'pointOnCurve', point: 'p3', curve: 'l1' },
      { id: 'c3', type: 'midpoint', point: 'p3', line: 'l1' },
    ]);
    expect(doc.idCounters).toEqual({ sketch: 7, p: 3, l: 1, c: 3 });
  });
});
