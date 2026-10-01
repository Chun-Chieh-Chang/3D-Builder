/**
 * Phase 3a-6d (C4.7): the rib. The one line of a sketch becomes a wall that grows from the line, in the plane of the sketch and square to the line,
 * as far as the body, and joins it. Volumes are hand-calculated (thickness × length × height), every face has a name of its own, what comes after
 * finds its edges, and every way it cannot be done says why (ADR 0033).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type PartDoc, type RibFeature, type SketchEntity } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, edge, extrude, faceNamed, fillet, front, rectangle, sketch, statuses, type SketchParts } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volume = (r: RebuildResult) => r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0);

const right = { kind: 'datum', name: 'plane:right' } as const; // normal +X; its x runs along −Z, its y along Y
const point = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const parts = (...entities: SketchEntity[]): SketchParts => ({ entities, constraints: [] });
/** A line in the plane x = 0 at height `z` from y0 to y1 (drawn from y0 to y1), so the rib grows down (−Z) unless it is flipped. */
const stroke = (z: number, y0 = -10, y1 = 10): SketchParts => parts(point('a', -z, y0), point('b', -z, y1), { id: 'l', type: 'line', p1: 'a', p2: 'b' });
const plate = (depth = 10): Feature[] => [sketch('s1', front, rectangle('p', -20, -20, 40, 40)), extrude('e1', 's1', 'boss', { type: 'blind', depth: String(depth) })];
const rib = (extra: Partial<RibFeature> = {}): Feature => ({ id: 'rib1', type: 'rib', name: 'rib1', suppressed: false, sketch: 'sr', thickness: '4', side: 'mid', ...extra }) as Feature;
const make = (line: SketchParts, extra: Partial<RibFeature> = {}, depth = 10) => build(...plate(depth), sketch('sr', right, line), rib(extra));

describe('the rib (C4.7)', () => {
  it('a line 15 above a plate: a wall 4 thick, 20 long, 15 high, joined to the plate; a face for each side, each end and the line', () => {
    const r = rebuild(make(stroke(25)));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(40 * 40 * 10 + 15 * 20 * 4, 6);
    expect(r.bodies).toHaveLength(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    const names = r.body!.names.faces;
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['rib1:cap:start', 'rib1:side:sr.l.neg', 'rib1:side:sr.l.pos', 'rib1:side:sr.l.end1', 'rib1:side:sr.l.end2']));
    // the wall is 4 thick about the sketch plane, and its free edge is at z = 25
    expect(faceNamed(r, 'rib1:side:sr.l.pos').center[0]).toBeCloseTo(2, 6);
    expect(faceNamed(r, 'rib1:side:sr.l.neg').center[0]).toBeCloseTo(-2, 6);
    expect(faceNamed(r, 'rib1:cap:start').center[2]).toBeCloseTo(25, 6);
  });

  it('the thickness on one side of the sketch plane or the other', () => {
    const one = rebuild(make(stroke(25), { side: 'positive' }));
    expect(failures(one)).toEqual([]);
    expect(volume(one)).toBeCloseTo(16000 + 1200, 6);
    expect(faceNamed(one, 'rib1:side:sr.l.pos').center[0]).toBeCloseTo(4, 6);
    expect(faceNamed(one, 'rib1:side:sr.l.neg').center[0]).toBeCloseTo(0, 6);
    const other = rebuild(make(stroke(25), { side: 'negative' }));
    expect(faceNamed(other, 'rib1:side:sr.l.pos').center[0]).toBeCloseTo(0, 6);
    expect(faceNamed(other, 'rib1:side:sr.l.neg').center[0]).toBeCloseTo(-4, 6);
  });

  it('a line below the plate grows up to it only when flipped; the other way it says which way to turn it', () => {
    const wrong = rebuild(make(stroke(-15)));
    expect(failures(wrong).find((s) => s.startsWith('rib1='))).toContain('反轉方向');
    const flipped = rebuild(make(stroke(-15), { flip: true }));
    expect(failures(flipped)).toEqual([]);
    expect(volume(flipped)).toBeCloseTo(16000 + 15 * 20 * 4, 6);
    expect(faceNamed(flipped, 'rib1:cap:start').center[2]).toBeCloseTo(-15, 6);
  });

  it('stops at the first thing it meets: a rib over a plate with a step stops on the step', () => {
    // a block 10 higher over the half of the plate where y > 0: the line spans y from −10 to 10, so the rib meets the block over y in (0, 10) and the plate over y in (−10, 0)
    const doc = build(...plate(), sketch('s2', front, rectangle('q', -20, 0, 40, 20)), extrude('e2', 's2', 'boss', { type: 'blind', depth: '20' }), sketch('sr', right, stroke(35)), rib());
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    // plate 40×40×10, block 40×20×20 on it (z from 0 to 20 for y from 0 to 20), rib from z = 35: over y in (0,10) down to 20, over y in (−10,0) down to 10
    expect(volume(r)).toBeCloseTo(16000 + 40 * 20 * 10 + 4 * 10 * 15 + 4 * 10 * 25, 6);
  });

  it('says what is wrong: a rib that reaches nothing, no body, not one line, a thickness of nothing', () => {
    const msg = (doc: PartDoc) => failures(rebuild(doc)).find((s) => s.startsWith('rib1=')) ?? '';
    // beside the plate: there is body below the line (so it is not "away"), but the wall is not over it
    expect(msg(make(stroke(25, 30, 50)))).toContain('沒有碰到本體');
    // no body before the rib
    expect(msg(build(sketch('sr', right, stroke(25)), rib()))).toContain('之前沒有本體');
    // two lines, an arc, no line
    expect(msg(make(parts(point('a', -25, -10), point('b', -25, 10), point('c', -25, 20), { id: 'l', type: 'line', p1: 'a', p2: 'b' }, { id: 'm', type: 'line', p1: 'b', p2: 'c' })))).toContain('剛好一條直線');
    expect(msg(make(parts(point('c', 0, 0), point('s', -25, 0), point('e', -25, 10), { id: 'k', type: 'arc', center: 'c', start: 's', end: 'e' })))).toContain('剛好一條直線');
    expect(msg(make(parts(point('a', -25, 0))))).toContain('剛好一條直線');
    expect(() => make(stroke(25), { thickness: '0' })).toThrow('必須大於 0');
  });

  it('what follows finds its edges: a fillet on an edge of the rib after a fillet of the plate, and a thicker plate shortens the rib', () => {
    const doc = build(...plate(), fillet('f0', [edge('{e1:cap:start|e1:side:s1.pl0}')], '1'), sketch('sr', right, stroke(25)), rib(), fillet('f1', [edge('{rib1:cap:start|rib1:side:sr.l.pos}')], '1'));
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    const thick = rebuild(applyCommand(doc, { type: 'setEndCondition', featureId: 'e1', dir: 'dir1', value: { type: 'blind', depth: '12' } }));
    expect(failures(thick)).toEqual([]);
    // the plate gains 40 × 40 × 2, the rib loses 2 × (20 × 4) of its height
    expect(volume(thick) - volume(r)).toBeCloseTo(40 * 40 * 2 - 2 * 20 * 4, 2);
  });

  it('commands: the rib is set as a whole', () => {
    const doc = make(stroke(25));
    const moved = applyCommand(doc, { type: 'setRib', featureId: 'rib1', rib: { thickness: '6', side: 'mid', flip: true } });
    expect((moved.features.find((f) => f.id === 'rib1') as RibFeature).flip).toBe(true);
    const back = applyCommand(moved, { type: 'setRib', featureId: 'rib1', rib: { thickness: '6', side: 'mid' } });
    expect('flip' in (back.features.find((f) => f.id === 'rib1') as RibFeature)).toBe(false);
    expect(() => applyCommand(doc, { type: 'setRib', featureId: 'e1', rib: { thickness: '4', side: 'mid' } })).toThrow('只有肋材');
    expect(() => applyCommand(doc, { type: 'setRib', featureId: 'rib1', rib: { thickness: '-1', side: 'mid' } })).toThrow('必須大於 0');
  });
});
