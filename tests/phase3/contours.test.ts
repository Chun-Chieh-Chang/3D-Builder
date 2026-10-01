/**
 * Phase 3a-4c (C1.34): a boss or cut may use some of its sketch's contours. Each is remembered as the entities that bound one
 * region and found again by what they share with the region, so a change to the sketch that keeps most of a contour keeps the
 * choice (ADR 0025).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, SCHEMA_VERSION, type Feature, type PartDoc } from '@3db/model';
import { readPartFile, writePartFile } from '@3db/io';
import { contourChoices, contourIds, PlaneGcsSolver, selectContours } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, extrude, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volume = (r: RebuildResult) => r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0);
const regionsOf = (r: RebuildResult, id: string) => r.sketches.get(id)!.profiles.regions;

/** Three separate contours: a 20 × 10 rectangle, a 10 × 10 one and a circle of radius 4. */
const three = () => sketch('s', front, rectangle('a', 0, 0, 20, 10), rectangle('b', 40, 0, 10, 10), circle('c', 80, 5, 4));
const boss = (contours?: string[][]): Feature => ({ ...extrude('e', 's', 'boss', { type: 'blind', depth: '10' }), ...(contours ? { contours } : {}) }) as Feature;

describe('contours of a sketch (C1.34)', () => {
  it('lists the regions of a sketch with their areas (hand-calculated) and remembers each by its boundary', () => {
    const r = rebuild(build(three(), boss()));
    const choices = contourChoices(regionsOf(r, 's'));
    expect(choices.map((c) => Math.round(c.area * 1e6) / 1e6).sort((x, y) => x - y)).toEqual([100, 200, Math.round(16 * Math.PI * 1e6) / 1e6].sort((x, y) => x - y));
    expect(choices.map((c) => c.ids.join('+')).sort()).toEqual(['al0+al1+al2+al3', 'bl0+bl1+bl2+bl3', 'c']);
    expect(choices.every((c) => c.holes === 0)).toBe(true);
  });

  it('a feature without a choice uses them all, as before', () => {
    const r = rebuild(build(three(), boss()));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo((200 + 100 + 16 * Math.PI) * 10, 6);
  });

  it('uses only the chosen contours, by their boundary ids', () => {
    const one = rebuild(build(three(), boss([['al0', 'al1', 'al2', 'al3']])));
    expect(failures(one)).toEqual([]);
    expect(volume(one)).toBeCloseTo(2000, 6);
    const two = rebuild(build(three(), boss([['al0', 'al1', 'al2', 'al3'], ['c']])));
    expect(volume(two)).toBeCloseTo((200 + 16 * Math.PI) * 10, 6);
  });

  it('the face names of what was chosen are the same as when everything is extruded', () => {
    const all = rebuild(build(three(), boss()));
    const some = rebuild(build(three(), boss([['bl0', 'bl1', 'bl2', 'bl3']])));
    const side = (r: RebuildResult) => r.body!.names.faces.filter((n) => n.includes('bl1'));
    expect(side(some)).toEqual(side(all));
    expect(side(some).length).toBeGreaterThan(0);
  });

  it('a cut with one of two circles makes one hole: the volume loses one cylinder', () => {
    const base = sketch('base', front, rectangle('p', 0, 0, 100, 100));
    const holes = sketch('holes', front, circle('h1', 30, 50, 5), circle('h2', 70, 50, 5));
    const cut = (contours?: string[][]): Feature => ({ ...extrude('cut', 'holes', 'cut', { type: 'throughAll', reverse: true }), ...(contours ? { contours } : {}) }) as Feature;
    const bossBase = extrude('b', 'base', 'boss', { type: 'blind', depth: '10' });
    const both = rebuild(build(base, bossBase, holes, cut()));
    const one = rebuild(build(base, bossBase, holes, cut([['h1']])));
    expect(failures(both)).toEqual([]);
    expect(failures(one)).toEqual([]);
    expect(volume(both)).toBeCloseTo(100000 - 2 * 250 * Math.PI, 6);
    expect(volume(one)).toBeCloseTo(100000 - 250 * Math.PI, 6);
  });
});

describe('finding a contour again (C1.34)', () => {
  const regions = () => regionsOf(rebuild(build(three(), boss())), 's');

  it('matches by what the boundary shares: an entity added or removed is still the same contour', () => {
    const rs = regions();
    const a = contourIds(rs.find((r) => contourIds(r).includes('al0'))!);
    expect(selectContours(rs, [[...a, 'newArc']])).toMatchObject({ missing: 0 }); // 4 of 5
    expect(selectContours(rs, [a.slice(0, 3)]).regions).toHaveLength(1); // 3 of 4
    expect(selectContours(rs, [a.slice(0, 1)]).missing).toBe(1); // 1 of 4: too little
    expect(selectContours(rs, [['gone1', 'gone2']]).missing).toBe(1);
    expect(selectContours(rs, [a, a]).regions).toHaveLength(1); // the same one twice
    expect(selectContours(rs, [a, ['c']]).regions).toHaveLength(2);
  });

  it('a chosen contour that is gone is an error the feature reports, naming what to do, and the rest of the part is unharmed', () => {
    const r = rebuild(build(three(), boss([['al0', 'al1', 'al2', 'al3'], ['x1', 'x2']])));
    expect(failures(r)).toEqual([expect.stringContaining('e=error')]);
    expect(failures(r)[0]).toContain('找不到');
  });
});

describe('the setContours command and the file (C1.34)', () => {
  it('sets, changes and clears the choice; refuses an empty one and a feature that has no contours', () => {
    let doc = build(three(), boss());
    doc = applyCommand(doc, { type: 'setContours', featureId: 'e', contours: [['al0', 'al1', 'al2', 'al3']] });
    expect(doc.features.find((f) => f.id === 'e')).toMatchObject({ contours: [['al0', 'al1', 'al2', 'al3']] });
    doc = applyCommand(doc, { type: 'setContours', featureId: 'e', contours: null });
    expect('contours' in doc.features.find((f) => f.id === 'e')!).toBe(false);
    expect(() => applyCommand(doc, { type: 'setContours', featureId: 'e', contours: [] })).toThrow('至少要選');
    expect(() => applyCommand(doc, { type: 'setContours', featureId: 'e', contours: [[]] })).toThrow('至少要選');
    expect(() => applyCommand(doc, { type: 'setContours', featureId: 's', contours: [['a']] })).toThrow('只有伸長與旋轉');
  });

  it('is saved with the part and read back: schema 12', async () => {
    expect(SCHEMA_VERSION).toBe(12);
    const doc = build(three(), boss([['c']]));
    const file = await readPartFile(await writePartFile(doc));
    expect(file.doc.schemaVersion).toBe(12);
    expect(file.doc.features.find((f) => f.id === 'e')).toMatchObject({ contours: [['c']] });
    expect(failures(rebuild(file.doc))).toEqual([]);
  });
});
