/**
 * Phase 3a-7c (C6.3): the mirror. Either what features added to the bodies and took from them, reflected across a plane, or whole bodies reflected into
 * bodies of their own or joined to the ones they touch. Volumes and areas are hand-calculated or equal to the original's, every face has a name of its own,
 * and a mirror that cannot be made says why (ADR 0036).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, mapRefs, type Feature, type MirrorFeature, type PartDoc, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { dependencies, Regenerator, suppressionTargets, type RebuildResult } from '@3db/regen';
import { build, circle, extrude, face, faceNamed, fillet, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volume = (r: RebuildResult) => r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0);
const area = (r: RebuildResult) => r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).area, 0);
const messageOf = (r: RebuildResult, id: string) => r.features.find((f) => f.id === id)?.message ?? '';

const right: Ref = { kind: 'datum', name: 'plane:right' }; // x = 0, normal +X
const datum = (id: string): Ref => ({ kind: 'datum', name: id });
const PLATE = 60 * 20 * 5;
const POST = Math.PI * 4 * 5; // radius 2, height 5
const middle: Feature = { id: 'pm', type: 'refPlane', name: 'pm', suppressed: false, def: { mode: 'offset', plane: right, distance: '30' } }; // x = 30: the middle of the plate

/** A plate 60 × 20 × 5 (z from 0 to 5) with a post of radius 2 and height 5 at (5, 10) on its top face. */
const plateAndPost = (): Feature[] => [
  sketch('s1', front, rectangle('p', 0, 0, 60, 20)),
  extrude('e1', 's1', 'boss', { type: 'blind', depth: '5' }),
  sketch('s2', face('e1:cap:end'), circle('k', 5, 10, 2)),
  extrude('e2', 's2', 'boss', { type: 'blind', depth: '5' }),
];
const plateAndHole = (): Feature[] => [
  sketch('s1', front, rectangle('p', 0, 0, 60, 20)),
  extrude('e1', 's1', 'boss', { type: 'blind', depth: '5' }),
  sketch('s2', face('e1:cap:end'), circle('k', 5, 10, 2)),
  extrude('c1', 's2', 'cut', { type: 'blind', depth: '5' }),
];
const features = (seeds: string[], plane: Ref = datum('pm'), extra: Partial<MirrorFeature> = {}): Feature => ({ id: 'mir1', type: 'mirror', name: 'mir1', suppressed: false, target: 'features', plane, seeds, bodies: [], ...extra });
const bodies = (ids: string[], plane: Ref = datum('pm'), extra: Partial<MirrorFeature> = {}): Feature => ({ id: 'mir1', type: 'mirror', name: 'mir1', suppressed: false, target: 'bodies', plane, seeds: [], bodies: ids.map((name) => ({ kind: 'body', name })), ...extra });

describe('the mirror of features (C6.3)', () => {
  it('a post across the middle of the plate: plate and two posts, the new one at x = 55 with faces of its own', () => {
    const r = rebuild(build(...plateAndPost(), middle, features(['e2'])));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(PLATE + 2 * POST, 6);
    expect(r.bodies).toHaveLength(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    const names = r.body!.names.faces;
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['mir1:mirror:e2:cap:end', 'mir1:mirror:e2:side:s2.k']));
    const c = faceNamed(r, 'mir1:mirror:e2:cap:end').center;
    expect([c[0], c[1], c[2]]).toEqual([expect.closeTo(55, 6), expect.closeTo(10, 6), expect.closeTo(10, 6)]);
    // the mirrored post's wall is the seed's, reflected: its area is the same
    expect(faceNamed(r, 'mir1:mirror:e2:side:s2.k').area).toBeCloseTo(faceNamed(r, 'e2:side:s2.k').area, 6);
  });

  it('a hole across the middle: the plate loses a second hole at x = 55', () => {
    const r = rebuild(build(...plateAndHole(), middle, features(['c1'])));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(PLATE - 2 * POST, 6);
    expect(faceNamed(r, 'mir1:mirror:c1:side:s2.k').center[0]).toBeCloseTo(55, 6);
  });

  it('across a face of the model, and across a default plane', () => {
    // the plate's own end face x = 60: the post is mirrored to x = 115, off the plate (a piece in the air)
    const off = rebuild(build(...plateAndPost(), features(['e2'], face('e1:side:s1.pl1'))));
    expect(messageOf(off, 'mir1')).toContain('沒有接觸到本體');
    // the top plane (y = 0 is the plate's front edge line): the post goes to y = −10, off the plate
    const flat = rebuild(build(...plateAndPost(), features(['e2'], { kind: 'datum', name: 'plane:top' })));
    expect(messageOf(flat, 'mir1')).toContain('沒有接觸到本體');
  });

  it('a hole mirrored out of the plate says so', () => {
    const r = rebuild(build(...plateAndHole(), features(['c1'], right)));
    expect(messageOf(r, 'mir1')).toContain('沒有碰到本體');
  });

  it('the seed changes size and the mirrored one follows: radius 2 → 3', () => {
    const doc = build(...plateAndPost(), middle, features(['e2']));
    const r = rebuild(applyCommand(doc, { type: 'setDimension', featureId: 's2', constraintId: 'kr', value: '3' }));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(PLATE + 2 * Math.PI * 9 * 5, 6);
  });

  it('the plane moves and so does the mirror: the middle at x = 40 puts the post at x = 75, beyond the plate (and says so)', () => {
    const doc = build(...plateAndPost(), middle, features(['e2']));
    const moved = applyCommand(doc, { type: 'setRefPlane', featureId: 'pm', def: { mode: 'offset', plane: right, distance: '40' } });
    expect(messageOf(rebuild(moved), 'mir1')).toContain('沒有接觸到本體');
    const nearer = applyCommand(doc, { type: 'setRefPlane', featureId: 'pm', def: { mode: 'offset', plane: right, distance: '20' } });
    const r = rebuild(nearer);
    expect(failures(r)).toEqual([]);
    expect(faceNamed(r, 'mir1:mirror:e2:cap:end').center[0]).toBeCloseTo(35, 6);
  });

  it('a fillet on the rim of the mirrored post finds its edge', () => {
    const rim: Ref = { kind: 'edge', name: '{mir1:mirror:e2:cap:end|mir1:mirror:e2:side:s2.k}' };
    const r = rebuild(build(...plateAndPost(), middle, features(['e2']), fillet('f1', [rim], '0.5')));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeLessThan(PLATE + 2 * POST);
  });

  it('a boss and its fillet mirrored together', () => {
    const rim: Ref = { kind: 'edge', name: '{e2:cap:end|e2:side:s2.k}' };
    const r = rebuild(build(...plateAndPost(), fillet('f1', [rim], '0.5'), middle, features(['e2', 'f1'])));
    expect(failures(r)).toEqual([]);
    const single = rebuild(build(...plateAndPost(), fillet('f1', [rim], '0.5')));
    expect(volume(r)).toBeCloseTo(PLATE + 2 * (volume(single) - PLATE), 5);
  });

  it('a seed that failed, a plane that is not flat, and nothing chosen say so', () => {
    const post: Ref = { kind: 'face', name: 'e2:side:s2.k', fingerprint: { type: 'cylinder', size: 1, center: [5, 10, 7.5] } };
    expect(messageOf(rebuild(build(...plateAndPost(), middle, features(['e2'], post))), 'mir1')).toContain('鏡射面必須是平面');
    const none = rebuild(build(...plateAndPost(), middle, features([])));
    expect(messageOf(none, 'mir1')).toContain('請選擇要排列或鏡射的特徵');
  });
});

describe('the mirror of bodies (C6.3)', () => {
  it('a body mirrored into a body of its own: the same volume and the same surface, a second body, every name its own', () => {
    // across the plane x = 0 (the plate starts there): the mirror image does not merge (merge off)
    const doc = build(...plateAndPost(), bodies(['e1'], right, { merge: false }));
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(r.bodies).toHaveLength(2);
    const [original, image] = r.bodies.map((b) => kernel.massProps(b.shape));
    expect(image!.volume).toBeCloseTo(original!.volume, 9);
    expect(image!.area).toBeCloseTo(original!.area, 9);
    expect(image!.center[0]).toBeCloseTo(-original!.center[0], 9);
    expect(kernel.isValid(r.bodies[1]!.shape)).toBe(true);
    const names = r.body!.names.faces;
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((n) => n.startsWith('mir1:mirror:')).length).toBe(r.bodies[1]!.faces);
    expect(r.bodies[1]!.id).toBe('mir1#1');
  });

  it('merged, it joins the body it touches: the plate and its image across the end face are one body of twice the volume, symmetric', () => {
    const r = rebuild(build(...plateAndPost(), bodies(['e1'], right)));
    expect(failures(r)).toEqual([]);
    expect(r.bodies).toHaveLength(1);
    expect(volume(r)).toBeCloseTo(2 * (PLATE + POST), 6);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    // the faces of the two plates that lay together are gone; the others are all there
    expect(faceNamed(r, 'mir1:mirror:e2:cap:end').center[0]).toBeCloseTo(-5, 6);
    // the area is twice the original less the two faces that met (20 × 5 each)
    const single = rebuild(build(...plateAndPost()));
    expect(area(r)).toBeCloseTo(2 * area(single) - 2 * 20 * 5, 6);
  });

  it('nothing chosen and a body that is not there say so', () => {
    expect(messageOf(rebuild(build(...plateAndPost(), bodies([], right))), 'mir1')).toContain('請選擇要鏡射的本體');
    expect(messageOf(rebuild(build(...plateAndPost(), bodies(['nope'], right))), 'mir1')).toContain('nope');
  });
});

describe('what depends on what', () => {
  it('a mirror is the child of its seeds (or the features that made its bodies) and of its plane', () => {
    const docF = build(...plateAndPost(), middle, features(['e2']));
    expect(dependencies(docF).parents.get('mir1')).toEqual(['e2', 'pm']);
    const docB = build(...plateAndPost(), middle, bodies(['e1']));
    expect(dependencies(docB).parents.get('mir1')).toEqual(['e1', 'pm']);
    expect(suppressionTargets(docF, 'pm', 'suppress')).toEqual(['pm', 'mir1']);
    expect(suppressionTargets(docF, 'e2', 'suppress')).toEqual(['e2', 'mir1']);
  });

  it('the command takes seeds that are before it and can be repeated, refers to bodies by body, and a plane before it', () => {
    const doc = build(...plateAndPost(), middle, features(['e2']));
    const value = (p: Partial<Pick<MirrorFeature, 'target' | 'plane' | 'seeds' | 'bodies' | 'merge'>>) => ({ target: 'features' as const, plane: datum('pm'), seeds: ['e2'], bodies: [], ...p });
    expect(applyCommand(doc, { type: 'setMirror', featureId: 'mir1', value: value({ merge: false }) }).features.find((f) => f.id === 'mir1')).toMatchObject({ merge: false });
    expect(() => applyCommand(doc, { type: 'setMirror', featureId: 'mir1', value: value({ seeds: ['s2'] }) })).toThrow('不能排列');
    expect(() => applyCommand(doc, { type: 'setMirror', featureId: 'mir1', value: value({ seeds: ['mir1'] }) })).toThrow('必須在排列之前');
    expect(() => applyCommand(doc, { type: 'setMirror', featureId: 'mir1', value: value({ bodies: [{ kind: 'face', name: 'x' }] }) })).toThrow();
    expect(() => applyCommand(doc, { type: 'setMirror', featureId: 'e2', value: value({}) })).toThrow('只有鏡射');
    expect(() => applyCommand(doc, { type: 'setMirror', featureId: 'mir1', value: value({ plane: { kind: 'edge', name: 'x' } }) })).toThrow();
  });

  it('a reference repaired in a mirror is replaced', () => {
    const doc = build(...plateAndPost(), middle, bodies(['e1']));
    const f = doc.features.find((x) => x.id === 'mir1')!;
    const swapped = mapRefs(f, (ref) => (ref.kind === 'body' ? { ...ref, name: 'e9' } : ref));
    expect(swapped).toMatchObject({ replaced: 1, feature: { bodies: [{ name: 'e9' }] } });
  });
});
