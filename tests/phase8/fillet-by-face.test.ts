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

describe('a fillet that cannot be made says why and how big it can be', () => {
  // 40 × 30 × 12 with a Ø8 hole in the middle: the strip between the hole and the long edge is 11 wide, so two rounds meet at a radius a little over 5.5
  const holed = (radius: string): Feature[] => [...block(), sketch('s2', face('e1:cap:end'), circle('c', 20, 15, 4)), extrude('c1', 's2', 'cut', { type: 'throughAll' }), filletOf('f1', [TOP], radius)];
  it('a radius of 8 is refused with the radius that works for the same edges, and that radius works', () => {
    const r = rebuild(build(...holed('8')));
    const f1 = r.features.find((f) => f.id === 'f1')!;
    expect(f1.status).toBe('error');
    expect(f1.message).toContain('半徑 8');
    const max = Number(/半徑 ([\d.]+) 以下可以/.exec(f1.message ?? '')?.[1]);
    expect(max).toBeGreaterThan(4.5);
    expect(max).toBeLessThan(6);
    expect(statuses(rebuild(build(...holed(String(max))))).at(-1)).toBe('f1=ok');
    expect(statuses(rebuild(build(...holed('5')))).at(-1)).toBe('f1=ok');
  });
});

describe('the document with faces in a fillet', () => {
  it('is a new schema, written and read back as it was, and an older file is read as it was', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(52);
    const doc = add(build(...block()), filletOf('f1', [TOP, BOTTOM]), chamferOf('c1', [TOP], '1', '1'));
    const back = parsePart(serializePart(doc));
    expect(back.schemaVersion).toBe(SCHEMA_VERSION);
    expect(back.features.find((f) => f.id === 'f1')).toMatchObject({ type: 'fillet', faces: [{ name: 'e1:cap:end' }, { name: 'e1:cap:start' }] });
    expect(back.features.find((f) => f.id === 'c1')).toMatchObject({ type: 'chamfer', faces: [{ name: 'e1:cap:end' }] });
    // a file of version 42 has no faces and reads as it did
    const old = JSON.parse(serializePart(add(build(...block()), filletOf('f1', [], '2', [edgeRef('x')])))) as { schemaVersion: number };
    old.schemaVersion = 42;
    const read = parsePart(JSON.stringify(old));
    expect(read.schemaVersion).toBe(SCHEMA_VERSION);
    expect(read.features.find((f) => f.id === 'f1')).not.toHaveProperty('faces');
  });

  it('is refused with the reason by a program that is older: the version says so', () => {
    const future = JSON.parse(serializePart(build(...block()))) as { schemaVersion: number };
    future.schemaVersion = SCHEMA_VERSION + 1;
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

/** The name of the planar face of the rebuilt body that faces `n` and whose center is `along` along it. */
function faceName(r: RebuildResult, n: [number, number, number], along: number): string {
  const topo = r.body!.topology;
  const i = topo.faces.findIndex((f) => f.surface === 'plane' && f.normal && f.normal[0] * n[0] + f.normal[1] * n[1] + f.normal[2] * n[2] > 1 - 1e-9 && Math.abs(f.center[0] * n[0] + f.center[1] * n[1] + f.center[2] * n[2] - along) < 1e-6);
  expect(i, `a face facing ${n} at ${along}`).toBeGreaterThanOrEqual(0);
  return r.body!.names.faces[i]!;
}

const faceFilletOf = (id: string, first: string[], second: string[], radius = '2'): Feature => ({ id, type: 'fillet', name: id, suppressed: false, edges: [], kind: 'face', faces: first.map(face), faces2: second.map(face), radius });

describe('a face fillet (面圓角): between two groups of faces that meet', () => {
  /** An L: a plate 40 × 30 × 10 and a wall 40 × 10 × 30 along its y = 0 edge. */
  const bracket = (): Feature[] => [
    sketch('s1', front, rectangle('a', 0, 0, 40, 30)),
    extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
    sketch('s2', front, rectangle('w', 0, 0, 40, 10)),
    extrude('e2', 's2', 'boss', { type: 'blind', depth: '30' }),
  ];

  it('rounds the inside corner of the L, a concave edge: it adds (1 − π/4) r² L', () => {
    const base = rebuild(build(...bracket()));
    const wall = faceName(base, [0, 1, 0], 10); // the inner face of the wall, y = 10
    const plate = faceName(base, [0, 0, 1], 10); // the top of the plate, z = 10
    const r = rebuild(add(build(...bracket()), faceFilletOf('f1', [wall], [plate], '3')));
    expect(statuses(r).at(-1)).toBe('f1=ok');
    expect(volume(r) - volume(base)).toBeCloseTo((1 - Math.PI / 4) * 9 * 40, 6);
  });

  it('rounds a convex edge, the same as picking the edge: the top and the front of a block', () => {
    const base = rebuild(build(...block()));
    const r = rebuild(add(build(...block()), faceFilletOf('f1', ['e1:cap:end'], [faceName(base, [0, -1, 0], 0)])));
    expect(statuses(r).at(-1)).toBe('f1=ok');
    expect(volume(r)).toBeCloseTo(14400 - (1 - Math.PI / 4) * 4 * 40, 6);
  });

  it('rounds every edge where the groups meet: the top against the front and the back', () => {
    const base = rebuild(build(...block()));
    const r = rebuild(add(build(...block()), faceFilletOf('f1', ['e1:cap:end'], [faceName(base, [0, -1, 0], 0), faceName(base, [0, 1, 0], 30)])));
    expect(statuses(r).at(-1)).toBe('f1=ok');
    expect(volume(r)).toBeCloseTo(14400 - (1 - Math.PI / 4) * 4 * 80, 6);
  });

  it('is an error that says why when the groups share no edge: the front and the back of a block', () => {
    const base = rebuild(build(...block()));
    const r = rebuild(add(build(...block()), faceFilletOf('f1', [faceName(base, [0, -1, 0], 0)], [faceName(base, [0, 1, 0], 30)])));
    const f1 = r.features.find((f) => f.id === 'f1')!;
    expect(f1.status).toBe('error');
    expect(f1.message).toContain('沒有共同的邊');
    expect(volume(r)).toBeCloseTo(14400, 6); // the document is not harmed: the rest is as it was
  });

  it('needs a face in each group', () => {
    const r = rebuild(add(build(...block()), faceFilletOf('f1', ['e1:cap:end'], [])));
    expect(r.features.find((f) => f.id === 'f1')!.message).toContain('兩組面各選至少一個面');
  });

  it('says so when the edges where the groups meet are smooth ones already: the top and the round beside it', () => {
    const rounded = rebuild(add(build(...block()), filletOf('f1', [TOP], '2')));
    const topo = rounded.body!.topology;
    const round = rounded.body!.names.faces[topo.faces.findIndex((f) => f.surface === 'cylinder')]!;
    const r = rebuild(add(build(...block()), filletOf('f1', [TOP], '2'), faceFilletOf('f2', ['e1:cap:end'], [round], '0.5')));
    expect(r.features.find((f) => f.id === 'f2')!.message).toContain('相切');
  });

  it('follows the model: widen the block and the fillet stays on the edge, with the same radius', () => {
    const wide = (w: string) => block().map((f) => (f.type === 'sketch' ? { ...f, constraints: f.constraints.map((c) => (c.id === 'aw' ? { ...c, value: w } : c)) } : f));
    const base = rebuild(build(...wide('40')));
    const front_ = faceName(base, [0, -1, 0], 0);
    const doc = (w: string) => add(build(...wide(w)), faceFilletOf('f1', ['e1:cap:end'], [front_]));
    expect(volume(rebuild(doc('40')))).toBeCloseTo(14400 - (1 - Math.PI / 4) * 4 * 40, 6);
    const r = rebuild(doc('60'));
    expect(statuses(r).at(-1)).toBe('f1=ok');
    expect(volume(r)).toBeCloseTo(60 * 30 * 12 - (1 - Math.PI / 4) * 4 * 60, 6);
  });
});

describe('the commands of a fillet with groups of faces', () => {
  it('sets the kind and the groups, and takes them away with the constant radius', () => {
    let doc = add(build(...block()), filletOf('f1', []));
    doc = applyCommand(doc, { type: 'setFilletSets', featureId: 'f1', kind: 'face', faces: [TOP], faces2: [BOTTOM] });
    const f = () => doc.features.find((x) => x.id === 'f1') as Extract<Feature, { type: 'fillet' }>;
    expect(f()).toMatchObject({ kind: 'face', faces: [{ name: 'e1:cap:end' }], faces2: [{ name: 'e1:cap:start' }] });
    doc = applyCommand(doc, { type: 'setFilletSets', featureId: 'f1', kind: 'constant', faces: [TOP] });
    expect(f().kind).toBeUndefined();
    expect(f().faces2).toBeUndefined();
    expect(f().faces).toHaveLength(1);
  });

  it('takes only faces, and only a fillet has a kind', () => {
    const doc = add(build(...block()), filletOf('f1', []), chamferOf('c1', [], '1', '1'));
    expect(() => applyCommand(doc, { type: 'setFilletSets', featureId: 'f1', kind: 'face', faces: [edgeRef('x')] })).toThrow();
    expect(() => applyCommand(doc, { type: 'setFilletSets', featureId: 'f1', kind: 'constant', faces: [TOP], faces2: [BOTTOM] })).toThrow();
    expect(() => applyCommand(doc, { type: 'setFilletSets', featureId: 'c1', kind: 'face', faces: [TOP] })).toThrow();
  });

  it('has its groups repaired and followed as dependencies like the rest', () => {
    let doc = add(build(...block()), faceFilletOf('f1', ['old'], ['older']));
    doc = applyCommand(doc, { type: 'replaceRef', featureId: 'f1', from: face('older'), to: BOTTOM });
    expect((doc.features.find((x) => x.id === 'f1') as Extract<Feature, { type: 'fillet' }>).faces2!.map((r) => r.name)).toEqual(['e1:cap:start']);
    const parents = dependencies(add(build(...block()), faceFilletOf('f1', ['e1:cap:end'], ['e1:cap:start']))).parents.get('f1');
    expect(parents).toContain('e1');
  });

  it('is written and read back', () => {
    const doc = add(build(...block()), faceFilletOf('f1', ['e1:cap:end'], ['e1:cap:start']));
    const back = parsePart(serializePart(doc));
    expect(back.features.find((x) => x.id === 'f1')).toMatchObject({ kind: 'face', faces: [{ name: 'e1:cap:end' }], faces2: [{ name: 'e1:cap:start' }] });
  });
});

const fullRoundOf = (id: string, side1: string[], center: string[], side2: string[]): Feature => ({ id, type: 'fillet', name: id, suppressed: false, edges: [], kind: 'full', faces: side1.map(face), center: center.map(face), faces2: side2.map(face), radius: '2' });

describe('a full round fillet (完整圓角): the top between two parallel sides becomes half a cylinder', () => {
  /** 40 × 30 × 20, or 40 wide and `d` deep. */
  const tall = (d = '30', h = '20'): Feature[] => [
    sketch('s1', front, rectangle('a', 0, 0, 40, Number(d))),
    extrude('e1', 's1', 'boss', { type: 'blind', depth: h }),
  ];
  const sides = (r: RebuildResult, d: number): [string, string] => [faceName(r, [0, -1, 0], 0), faceName(r, [0, 1, 0], d)];

  it('40 × 30 × 20, the top between the front and the back: 24000 − 40 (30 · 15 − π 15² / 2) = 20137.17, and one half cylinder instead of the top', () => {
    const base = rebuild(build(...tall()));
    const [s1, s2] = sides(base, 30);
    const r = rebuild(add(build(...tall()), fullRoundOf('f1', [s1], ['e1:cap:end'], [s2])));
    expect(statuses(r).at(-1)).toBe('f1=ok');
    expect(volume(r)).toBeCloseTo(24000 - 40 * (30 * 15 - (Math.PI * 225) / 2), 6);
    const topo = r.body!.topology;
    expect(topo.faces).toHaveLength(6);
    const round = topo.faces.findIndex((f) => f.surface === 'cylinder');
    expect(round).toBeGreaterThanOrEqual(0);
    expect(topo.faces[round]!.geometry).toMatchObject({ radius: 15 });
    // the round is the top, rounded: it keeps the name the top had
    expect(r.body!.names.faces[round]).toBe('e1:cap:end');
    expect(topo.faces.filter((f) => f.surface === 'plane' && f.normal && f.normal[2] > 0.9)).toHaveLength(0); // no flat top is left
  });

  it('follows the model: 36 deep, the radius becomes 18 by itself', () => {
    const doc = (d: string) => {
      const features = tall(d);
      const base = rebuild(build(...features));
      const [s1, s2] = sides(base, Number(d));
      return add(build(...features), fullRoundOf('f1', [s1], ['e1:cap:end'], [s2]));
    };
    const r = rebuild(doc('36'));
    expect(statuses(r).at(-1)).toBe('f1=ok');
    expect(volume(r)).toBeCloseTo(36 * 40 * 20 - 40 * (36 * 18 - (Math.PI * 324) / 2), 6);
    const round = r.body!.topology.faces.find((f) => f.surface === 'cylinder')!;
    expect(round.geometry).toMatchObject({ radius: 18 });
  });

  it('a feature after it can still refer to the round by the name of the top', () => {
    const base = rebuild(build(...tall()));
    const [s1, s2] = sides(base, 30);
    const r = rebuild(add(build(...tall()), fullRoundOf('f1', [s1], ['e1:cap:end'], [s2]), filletOf('f2', [face('e1:cap:end')], '1')));
    // the round is smooth with nothing: its edges with the sides are smooth (tangent), those with the ends are not, so the second fillet works on the ends
    expect(statuses(r).at(-1)).toBe('f2=ok');
  });

  it('is an error that says why when the sides are not parallel: the front and the left', () => {
    const base = rebuild(build(...tall()));
    const r = rebuild(add(build(...tall()), fullRoundOf('f1', [faceName(base, [0, -1, 0], 0)], ['e1:cap:end'], [faceName(base, [-1, 0, 0], 0)])));
    expect(r.features.find((f) => f.id === 'f1')!.message).toContain('互相平行');
  });

  it('is an error when the sides are lower than half the width: 30 wide, 10 high', () => {
    const features = tall('30', '10');
    const base = rebuild(build(...features));
    const [s1, s2] = sides(base, 30);
    const r = rebuild(add(build(...features), fullRoundOf('f1', [s1], ['e1:cap:end'], [s2])));
    const f1 = r.features.find((f) => f.id === 'f1')!;
    expect(f1.status).toBe('error');
    expect(f1.message).toContain('做不出來');
    expect(volume(r)).toBeCloseTo(40 * 30 * 10, 6); // nothing was taken off
  });

  it('is an error when the center is not a rectangle between the sides: a hole in the top', () => {
    const features = [...tall(), sketch('s2', front, circle('k', 20, 15, 4)), extrude('c1', 's2', 'cut', { type: 'throughAll', reverse: true })];
    const base = rebuild(build(...features));
    expect(statuses(base).at(-1)).toBe('c1=ok');
    expect(volume(base)).toBeLessThan(24000 - 1000); // the hole is there
    const r = rebuild(add(build(...features), fullRoundOf('f1', [faceName(base, [0, -1, 0], 0)], ['e1:cap:end'], [faceName(base, [0, 1, 0], 30)])));
    expect(r.features.find((f) => f.id === 'f1')!.status).toBe('error');
  });

  it('needs the two sides and a center, and one center', () => {
    const base = rebuild(build(...tall()));
    const [s1, s2] = sides(base, 30);
    const missing = rebuild(add(build(...tall()), fullRoundOf('f1', [s1], ['e1:cap:end'], [])));
    expect(missing.features.find((f) => f.id === 'f1')!.message).toContain('兩個側面組與一個中央面');
    const two = rebuild(add(build(...tall()), fullRoundOf('f1', [s1], ['e1:cap:end', faceName(base, [0, 0, -1], 0)], [s2])));
    expect(two.features.find((f) => f.id === 'f1')!.message).toContain('只能選一個面');
  });

  it('is set and read back with the commands', () => {
    let doc = add(build(...tall()), filletOf('f1', []));
    doc = applyCommand(doc, { type: 'setFilletSets', featureId: 'f1', kind: 'full', faces: [face('a')], center: [face('b')], faces2: [face('c')] });
    const back = parsePart(serializePart(doc));
    expect(back.features.find((x) => x.id === 'f1')).toMatchObject({ kind: 'full', faces: [{ name: 'a' }], center: [{ name: 'b' }], faces2: [{ name: 'c' }] });
    expect(dependencies(doc).parents.get('f1')).toBeDefined();
  });
});
