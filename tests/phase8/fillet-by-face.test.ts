/**
 * F-1 (docs/fillet-by-face-plan.md): a fillet or a chamfer given faces rounds every edge of those faces, worked out each time the model is rebuilt. The numbers
 * are the plan's hand calculations (checked against OCCT in tests/phase8/fillet-spike.test.ts).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, parsePart, SCHEMA_VERSION, serializePart, type Feature, type PartDoc, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { dependencies, Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, extrude, face, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const volume = (r: RebuildResult) => kernel.massProps(r.body!.shape).volume;
const add = (doc: PartDoc, ...features: Feature[]) => features.reduce((d, feature) => applyCommand(d, { type: 'insertFeature', feature, index: d.features.length }), doc);

/** 40 × 30 × 12: its far cap `e1:cap:end` is the top. */
const block = (): Feature[] => [sketch('s1', front, rectangle('a', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '12' })];
const TOP = face('e1:cap:end');
const BOTTOM = face('e1:cap:start');
const edgeRef = (name: string): Ref => ({ kind: 'edge', name });

const filletOf = (id: string, faces: Ref[], radius = '2', edges: Ref[] = []): Feature => ({ id, type: 'fillet', name: id, suppressed: false, edges, ...(faces.length > 0 ? { faces } : {}), radius });
const chamferOf = (id: string, faces: Ref[], distance: string, second: string, flip = false): Feature => ({ id, type: 'chamfer', name: id, suppressed: false, edges: [], faces, mode: 'distanceDistance', distance, second, ...(flip ? { flip: true } : {}) });

/** What rounding the four edges of a face of a 40 × 30 block takes off, with the corners cut as a mitre: (1 − π/4) r² L − 2 r³ (5/6 − π/4) for each of the four, L = 140 in all. */
const roundedOff = (r: number) => (1 - Math.PI / 4) * r * r * 140 - 8 * r ** 3 * (5 / 6 - Math.PI / 4);
const chamferedOff = (d: number) => (d * d * 140) / 2 - (8 * d ** 3) / 6;

/** The planar face of the result whose normal is +z (up) and that is `z` high. */
const levelFace = (r: RebuildResult, z: number) => r.body!.topology.faces.filter((f) => f.surface === 'plane' && f.normal && f.normal[2] > 0.999 && Math.abs(f.center[2] - z) < 1e-6);

describe('a fillet given a face', () => {
  it('rounds the four edges of the top of a 40 × 30 × 12 block: the volume is the plan\'s hand calculation, and the same as picking the four edges', () => {
    const r = rebuild(add(build(...block()), filletOf('f1', [TOP])));
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 'f1=ok']);
    expect(volume(r)).toBeCloseTo(14400 - roundedOff(2), 6);
    expect(volume(r)).toBeCloseTo(14282.890822, 5);
    // the four edges of the top, picked one by one
    const base = rebuild(build(...block()));
    const topFace = base.body!.names.faces.indexOf('e1:cap:end');
    const edges = base.body!.topology.edges.flatMap((e, i) => (e.faces.includes(topFace) ? [edgeRef(base.body!.names.edges[i]!)] : []));
    expect(edges).toHaveLength(4);
    const byEdges = rebuild(add(build(...block()), filletOf('f1', [], '2', edges)));
    expect(Math.abs(volume(r) - volume(byEdges))).toBeLessThan(1e-6);
  });

  it('takes both faces when two are picked: the top and the bottom', () => {
    const r = rebuild(add(build(...block()), filletOf('f1', [TOP, BOTTOM])));
    expect(statuses(r).at(-1)).toBe('f1=ok');
    expect(volume(r)).toBeCloseTo(14400 - 2 * roundedOff(2), 6);
  });

  it('adds the faces to the edges picked, and an edge that is also an edge of a face is rounded once', () => {
    const base = rebuild(build(...block()));
    const topFace = base.body!.names.faces.indexOf('e1:cap:end');
    const edges = base.body!.topology.edges.flatMap((e, i) => (e.faces.includes(topFace) ? [edgeRef(base.body!.names.edges[i]!)] : []));
    const r = rebuild(add(build(...block()), filletOf('f1', [TOP], '2', [edges[0]!])));
    expect(statuses(r).at(-1)).toBe('f1=ok');
    expect(volume(r)).toBeCloseTo(14400 - roundedOff(2), 6);
  });

  it('rounds the edges the face has later: a slot cut in the top before the fillet is rounded at its rim', () => {
    const withSlot = [
      ...block(),
      sketch('s2', face('e1:cap:end'), rectangle('b', 10, 10, 6, 6)),
      extrude('c1', 's2', 'cut', { type: 'blind', depth: '4' }),
    ];
    const noFillet = rebuild(build(...withSlot));
    expect(statuses(noFillet).at(-1)).toBe('c1=ok');
    const r = rebuild(add(build(...withSlot), filletOf('f1', [TOP], '1')));
    expect(statuses(r).at(-1)).toBe('f1=ok');
    const outerOnly = volume(noFillet) - roundedOff(1); // what the four outer edges take, and no more
    expect(outerOnly - volume(r)).toBeGreaterThan(1); // the rim of the slot lost material too (a convex rim, 24 long, r 1: about 0.2146 · 24)
  });

  it('rounds the rim of a hole as well: a face with a hole has two loops', () => {
    const plate = [...block(), sketch('s2', front, circle('k', 20, 15, 4)), extrude('c1', 's2', 'cut', { type: 'throughAll', reverse: true })];
    const base = rebuild(build(...plate));
    expect(volume(base)).toBeCloseTo(14400 - Math.PI * 16 * 12, 6);
    const r = rebuild(add(build(...plate), filletOf('f1', [TOP], '1')));
    expect(statuses(r).at(-1)).toBe('f1=ok');
    // the hole's rim is a circle of radius 4: Pappus, the cross-section (1 − π/4)ρ² at a distance R + x̄ from the axis (the round is on the outside of a hole)
    const rho = 1;
    const area = (1 - Math.PI / 4) * rho * rho;
    const xbar = (rho * (5 / 6 - Math.PI / 4)) / (1 - Math.PI / 4);
    const hole = 2 * Math.PI * (4 + xbar) * area;
    const outer = (1 - Math.PI / 4) * 140 - 8 * (5 / 6 - Math.PI / 4);
    expect(volume(base) - volume(r)).toBeCloseTo(outer + hole, 4);
  });

  it('rounds the top of a cylinder, and not the seam of its side', () => {
    const cylinder = [sketch('s1', front, circle('k', 0, 0, 10)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' })];
    const r = rebuild(add(build(...cylinder), filletOf('f1', [face('e1:cap:end')], '1.5')));
    expect(statuses(r).at(-1)).toBe('f1=ok');
    const rho = 1.5;
    const area = (1 - Math.PI / 4) * rho * rho;
    const xbar = (rho * (5 / 6 - Math.PI / 4)) / (1 - Math.PI / 4);
    expect(volume(r)).toBeCloseTo(Math.PI * 100 * 20 - 2 * Math.PI * (10 - xbar) * area, 4);
  });

  it('given the side of a cylinder, rounds its two rims and leaves the seam alone', () => {
    const cylinder = [sketch('s1', front, circle('k', 0, 0, 10)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' })];
    const base = rebuild(build(...cylinder));
    const side = base.body!.names.faces[base.body!.topology.faces.findIndex((f) => f.surface === 'cylinder')]!;
    const r = rebuild(add(build(...cylinder), filletOf('f1', [face(side)], '1')));
    expect(statuses(r).at(-1)).toBe('f1=ok');
    const area = (1 - Math.PI / 4);
    const xbar = (5 / 6 - Math.PI / 4) / (1 - Math.PI / 4);
    expect(volume(base) - volume(r)).toBeCloseTo(2 * 2 * Math.PI * (10 - xbar) * area, 4);
  });

  it('leaves out the edges of the face that are smooth already, and says so when none is left', () => {
    const twice = rebuild(add(build(...block()), filletOf('f1', [TOP], '2'), filletOf('f2', [TOP, BOTTOM], '1')));
    expect(statuses(twice).slice(-2)).toEqual(['f1=ok', 'f2=ok']);
    // the top's edges are all smooth now: only the bottom took a fillet of 1
    const once = rebuild(add(build(...block()), filletOf('f1', [TOP], '2')));
    const bottomOnly = rebuild(add(build(...block()), filletOf('f1', [BOTTOM], '1')));
    expect(volume(once) - volume(twice)).toBeCloseTo(14400 - volume(bottomOnly), 5);
    const none = rebuild(add(build(...block()), filletOf('f1', [TOP], '2'), filletOf('f2', [TOP], '1')));
    expect(statuses(none).at(-1)).toContain('f2=error');
    expect(statuses(none).at(-1)).toContain('相切');
  });

  it('is an error that names the face when it is gone, with the references to repair', () => {
    const r = rebuild(add(build(...block()), filletOf('f1', [face('gone')])));
    const f1 = r.features.find((f) => f.id === 'f1')!;
    expect(f1.status).toBe('error');
    expect(f1.message).toContain('面');
    expect(f1.unresolved).toHaveLength(1);
    expect(f1.unresolved![0]!.ref.kind).toBe('face');
  });

  it('is slower than nothing by little: a face of twenty edges takes well under 300 ms', () => {
    const holes = Array.from({ length: 16 }, (_, i) => circle(`h${i}`, 4 + 5.5 * (i % 4) * 1.6, 5 + 6.5 * Math.floor(i / 4), 1));
    const plate = [...block(), sketch('s2', front, ...holes), extrude('c1', 's2', 'cut', { type: 'throughAll', reverse: true })];
    const doc = add(build(...plate), filletOf('f1', [TOP], '0.3'));
    // the best of five: the whole suite runs many files at once, and one slow run says more about the machine than about the fillet
    const runs = Array.from({ length: 5 }, () => rebuild(doc));
    const r = runs[0]!;
    const f1 = r.features.find((f) => f.id === 'f1')!;
    expect(f1.status, f1.message).toBe('ok');
    expect(Math.min(...runs.map((x) => x.features.find((f) => f.id === 'f1')!.ms))).toBeLessThan(300);
    expect(r.body!.topology.edges.filter((e) => e.curve === 'circle').length).toBeGreaterThanOrEqual(32); // 16 holes, each rim rounded
  });
});

describe('a chamfer given a face', () => {
  it('chamfers the four edges of the top 2 × 2: the hand calculation', () => {
    const r = rebuild(add(build(...block()), chamferOf('c1', [TOP], '2', '2')));
    expect(statuses(r).at(-1)).toBe('c1=ok');
    expect(volume(r)).toBeCloseTo(14400 - chamferedOff(2), 6);
    expect(volume(r)).toBeCloseTo(14130.666667, 5);
  });

  it('measures the first distance on the face that was picked: 3 on the top and 1 on the sides shrinks the top by 3', () => {
    const r = rebuild(add(build(...block()), chamferOf('c1', [TOP], '3', '1')));
    expect(levelFace(r, 12)[0]!.area).toBeCloseTo((40 - 6) * (30 - 6), 6);
  });

  it('measures it on the other face with 「反轉方向」: the top shrinks by 1', () => {
    const r = rebuild(add(build(...block()), chamferOf('c1', [TOP], '3', '1', true)));
    expect(levelFace(r, 12)[0]!.area).toBeCloseTo((40 - 2) * (30 - 2), 6);
  });

  it('follows the face when it has more edges later, like a fillet', () => {
    const withSlot = [...block(), sketch('s2', face('e1:cap:end'), rectangle('b', 10, 10, 6, 6)), extrude('c0', 's2', 'cut', { type: 'blind', depth: '4' })];
    const slotted = rebuild(build(...withSlot));
    const r = rebuild(add(build(...withSlot), chamferOf('c1', [TOP], '1', '1')));
    expect(statuses(r).at(-1)).toBe('c1=ok');
    expect(volume(slotted) - volume(r)).toBeGreaterThan(chamferedOff(1) + 1); // the outer four, and the slot's rim
  });
});

describe('the document with faces in a fillet', () => {
  it('is a new schema, written and read back as it was, and an older file is read as it was', () => {
    expect(SCHEMA_VERSION).toBe(43);
    const doc = add(build(...block()), filletOf('f1', [TOP, BOTTOM]), chamferOf('c1', [TOP], '1', '1'));
    const back = parsePart(serializePart(doc));
    expect(back.schemaVersion).toBe(43);
    expect(back.features.find((f) => f.id === 'f1')).toMatchObject({ type: 'fillet', faces: [{ name: 'e1:cap:end' }, { name: 'e1:cap:start' }] });
    expect(back.features.find((f) => f.id === 'c1')).toMatchObject({ type: 'chamfer', faces: [{ name: 'e1:cap:end' }] });
    // a file of version 42 has no faces and reads as it did
    const old = JSON.parse(serializePart(add(build(...block()), filletOf('f1', [], '2', [edgeRef('x')])))) as { schemaVersion: number };
    old.schemaVersion = 42;
    const read = parsePart(JSON.stringify(old));
    expect(read.schemaVersion).toBe(43);
    expect(read.features.find((f) => f.id === 'f1')).not.toHaveProperty('faces');
  });

  it('is refused with the reason by a program that is older: the version says so', () => {
    const future = JSON.parse(serializePart(build(...block()))) as { schemaVersion: number };
    future.schemaVersion = 44;
    expect(() => parsePart(JSON.stringify(future))).toThrow();
  });

  it('can be edited with a command: faces are added and taken away, nothing but faces goes in, and an empty list takes the field out', () => {
    let doc = add(build(...block()), filletOf('f1', [], '2', [edgeRef('x')]));
    doc = applyCommand(doc, { type: 'setEdges', featureId: 'f1', edges: [edgeRef('x')], faces: [TOP] });
    expect(doc.features.find((f) => f.id === 'f1')).toMatchObject({ faces: [{ name: 'e1:cap:end' }] });
    expect(() => applyCommand(doc, { type: 'setEdges', featureId: 'f1', edges: [], faces: [edgeRef('y')] })).toThrow();
    expect(() => applyCommand(doc, { type: 'setEdges', featureId: 'f1', edges: [TOP] })).toThrow();
    doc = applyCommand(doc, { type: 'setEdges', featureId: 'f1', edges: [edgeRef('x')] }); // faces left out: kept
    expect(doc.features.find((f) => f.id === 'f1')).toMatchObject({ faces: [{ name: 'e1:cap:end' }] });
    doc = applyCommand(doc, { type: 'setEdges', featureId: 'f1', edges: [edgeRef('x')], faces: [] });
    expect(doc.features.find((f) => f.id === 'f1')).not.toHaveProperty('faces');
  });

  it('can have a face repaired: 「改用這個」 replaces it, and two faces that become one are kept once', () => {
    let doc = add(build(...block()), filletOf('f1', [face('old'), face('older')]));
    doc = applyCommand(doc, { type: 'replaceRef', featureId: 'f1', from: face('old'), to: TOP });
    doc = applyCommand(doc, { type: 'replaceRef', featureId: 'f1', from: face('older'), to: TOP });
    expect((doc.features.find((f) => f.id === 'f1') as Extract<Feature, { type: 'fillet' }>).faces!.map((r) => r.name)).toEqual(['e1:cap:end']);
  });

  it('depends on the feature that made the face: it is among the parents', () => {
    const doc = add(build(...block()), filletOf('f1', [TOP]));
    expect(dependencies(doc).parents.get('f1')).toContain('e1');
  });
});
