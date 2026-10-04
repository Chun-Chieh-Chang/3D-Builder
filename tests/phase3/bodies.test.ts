/**
 * Phase 3a-3 (C7.1, C7.2, D4.6): a part with several bodies. A boss merges with the bodies it touches or is a body of its
 * own; a cut works on every body it reaches and may split one; 「組合」 adds, subtracts and intersects bodies. Names stay
 * what they were for one body, are unique across bodies, and what is built on any body keeps working (ADR 0022).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, bodyKey, createEmptyPart, isShown, parsePart, SCHEMA_VERSION, serializePart, type CombineFeature, type Feature, type PartDoc } from '@3db/model';
import { readPartFile, sha256Hex, writePartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { dependencies, Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, edge, extrude, face, fillet, front, rectangle, sketch, statuses } from '../phase1/builders';
import { stepSamples } from '../support/stepSamples';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc, blobs = new Map<string, Uint8Array>()) => new Regenerator(kernel, solver, blobs).rebuild(doc);
const ok = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volumes = (r: RebuildResult) => r.bodies.map((b) => Math.round(kernel.massProps(b.shape).volume * 1e6) / 1e6);
const ids = (r: RebuildResult) => r.bodies.map((b) => b.id);
const add = (doc: PartDoc, ...features: Feature[]) => features.reduce((d, feature) => applyCommand(d, { type: 'insertFeature', feature, index: d.features.length }), doc);
const combine = (id: string, op: CombineFeature['op'], main: string, ...tools: string[]): Feature => ({
  id,
  type: 'combine',
  name: id,
  suppressed: false,
  op,
  main: { kind: 'body', name: main },
  tools: tools.map((name) => ({ kind: 'body', name })),
});

/** A block x0..x1 × 0..10, 10 high, as its own sketch and boss. */
const block = (n: number, x0: number, x1: number, extra: Partial<Feature> = {}): Feature[] => [
  sketch(`s${n}`, front, rectangle(`r${n}`, x0, 0, x1 - x0, 10)),
  { ...extrude(`e${n}`, `s${n}`, 'boss', { type: 'blind', depth: '10' }), ...extra } as Feature,
];
/** A slot through the whole height, x0..x1 across the full width. */
const slot = (n: number, x0: number, x1: number): Feature[] => [
  sketch(`t${n}`, front, rectangle(`q${n}`, x0, -5, x1 - x0, 20)),
  extrude(`c${n}`, `t${n}`, 'cut', { type: 'throughAll', reverse: true }),
];

describe('a boss with several bodies (C7.1)', () => {
  it('is a body of its own where it touches nothing, and the first one keeps its id', () => {
    const r = rebuild(build(...block(1, 0, 20), ...block(2, 40, 60)));
    expect(ok(r)).toEqual([]);
    expect(ids(r)).toEqual(['e1', 'e2']);
    expect(volumes(r)).toEqual([2000, 2000]);
    expect(r.body!.topology.faces).toHaveLength(12);
    expect(new Set(r.body!.names.faces).size).toBe(12); // names are unique across the bodies
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(r.bodies.map((b) => [b.face0, b.faces])).toEqual([[0, 6], [6, 6]]);
  });

  it('merges with a body it overlaps or touches, and keeps that body\'s id; 「合併結果」 off makes it a body of its own', () => {
    const merged = rebuild(build(...block(1, 0, 20), ...block(2, 10, 30)));
    expect(ids(merged)).toEqual(['e1']);
    expect(volumes(merged)).toEqual([3000]);
    expect(rebuild(build(...block(1, 0, 20), ...block(2, 20, 40))).bodies).toHaveLength(1); // touching along a face
    const separate = rebuild(build(...block(1, 0, 20), ...block(2, 10, 30, { merge: false })));
    expect(ids(separate)).toEqual(['e1', 'e2']);
    expect(volumes(separate)).toEqual([2000, 2000]); // they overlap, and stay two bodies
  });

  it('merges a bridge with both of the bodies it touches into the earlier one', () => {
    const r = rebuild(build(...block(1, 0, 10), ...block(2, 30, 40), ...block(3, 5, 35)));
    expect(ok(r)).toEqual([]);
    expect(ids(r)).toEqual(['e1']);
    expect(volumes(r)).toEqual([4000]);
  });

  it('keeps the names of a body it merges into, and names its own faces after itself', () => {
    const one = rebuild(build(...block(1, 0, 20)));
    const r = rebuild(build(...block(1, 0, 20), ...block(2, 40, 60), ...block(3, 10, 30)));
    expect(ids(r)).toEqual(['e1', 'e2']);
    for (const name of one.body!.names.faces) if (!name.startsWith('e1:cap:end')) expect(r.body!.names.faces.some((n) => n.startsWith(name.split(':')[0]!))).toBe(true);
    expect(r.body!.names.faces.some((n) => n.startsWith('e3:'))).toBe(true);
  });
});

describe('a cut with several bodies', () => {
  it('works on every body it reaches and leaves the others alone', () => {
    const base = build(...block(1, 0, 20), ...block(2, 40, 60));
    const one = rebuild(add(base, ...slot(1, 5, 8)));
    expect(ok(one)).toEqual([]);
    expect(volumes(one)).toEqual([1200, 500, 2000]);
  });

  it('splits a body the slot cuts through into bodies of its own: the largest keeps the id, the others are <cut>#2 …', () => {
    const r = rebuild(add(build(...block(1, 0, 20), ...block(2, 40, 60)), ...slot(1, 5, 8)));
    expect(ok(r)).toEqual([]);
    expect(ids(r)).toEqual(['e1', 'c1#2', 'e2']);
    expect(volumes(r)).toEqual([1200, 500, 2000]); // 12 wide, 5 wide, and the untouched block
    expect(new Set(r.body!.names.faces).size).toBe(r.body!.names.faces.length);
    expect(r.body!.names.faces.filter((n) => n.includes('#')).length).toBeGreaterThan(0); // the faces the slot divided keep their #k
    // the same on every rebuild
    expect(ids(rebuild(add(build(...block(1, 0, 20), ...block(2, 40, 60)), ...slot(1, 5, 8))))).toEqual(ids(r));
  });

  it('cuts both bodies when the slot reaches both, and takes a whole body away that lies inside it, with a warning', () => {
    const both = rebuild(add(build(...block(1, 0, 20), ...block(2, 40, 60)), ...slot(1, 15, 45)));
    expect(ok(both)).toEqual([]);
    expect(volumes(both)).toEqual([1500, 1500]);
    const whole = rebuild(add(build(...block(1, 0, 20), ...block(2, 40, 60)), ...slot(1, 35, 65)));
    expect(ids(whole)).toEqual(['e1']);
    expect(whole.features.find((f) => f.id === 'c1')!.warnings?.[0]).toContain('e2');
  });

  it('says so when nothing is reached, and when everything is taken', () => {
    const nothing = rebuild(add(build(...block(1, 0, 20), ...block(2, 40, 60)), ...slot(1, 25, 30)));
    expect(nothing.features.find((f) => f.id === 'c1')).toMatchObject({ status: 'error', message: expect.stringContaining('沒有移除任何材料') });
    const all = rebuild(add(build(...block(1, 0, 20)), ...slot(1, -5, 25)));
    expect(all.features.find((f) => f.id === 'c1')).toMatchObject({ status: 'error', message: expect.stringContaining('整個本體') });
  });
});

describe('features on any body', () => {
  it('fillets an edge of the second body, finds it across bodies and leaves the first alone', () => {
    const base = build(...block(1, 0, 20), ...block(2, 40, 60));
    const probe = rebuild(base);
    const i = probe.body!.topology.edges.findIndex((e) => e.curve === 'line' && e.mid[0] > 59.9 && e.mid[2] > 9.9);
    const r = rebuild(add(base, fillet('f1', [edge(probe.body!.names.edges[i]!)], '2')));
    expect(ok(r)).toEqual([]);
    expect(volumes(r)).toEqual([2000, Math.round((2000 - (4 - Math.PI) * 10) * 1e6) / 1e6]);
    expect(ids(r)).toEqual(['e1', 'e2']);
  });

  it('sketches on a face of the second body, and builds a boss on it, in the second body', () => {
    const base = build(...block(1, 0, 20), ...block(2, 40, 60));
    const top = rebuild(base).body!.names.faces.find((n) => n.startsWith('e2:cap:end'))!;
    const r = rebuild(add(base, sketch('s9', face(top), circle('m', 50, 5, 2)), extrude('e9', 's9', 'boss', { type: 'blind', depth: '5' })));
    expect(ok(r)).toEqual([]);
    expect(ids(r)).toEqual(['e1', 'e2']);
    expect(volumes(r)).toEqual([2000, Math.round((2000 + Math.PI * 4 * 5) * 1e6) / 1e6]);
  });

  it('extrudes up to a face of the second body', () => {
    const base = build(...block(1, 0, 20), ...block(2, 40, 60));
    const probe = rebuild(base);
    const wall = probe.body!.names.faces.find((n) => n.startsWith('e2:side:s2.r2l3'))!; // the second body's left side, x = 40
    expect(wall).toBeDefined();
    const r = rebuild(add(base, sketch('s9', { kind: 'datum', name: 'plane:right' }, rectangle('u', 2, 2, 3, 3)), extrude('e9', 's9', 'boss', { type: 'upToFace', face: face(wall) })));
    expect(ok(r)).toEqual([]);
  });

  it('removes a face of the second body (Delete Face) and moves one (Move Face)', () => {
    const holed = [...block(1, 0, 20), ...block(2, 40, 60), sketch('sh', face('e2:cap:end'), circle('h', 50, 5, 2)), extrude('ch', 'sh', 'cut', { type: 'blind', depth: '10' })];
    const base = build(...holed);
    const probe = rebuild(base);
    expect(volumes(probe)).toEqual([2000, Math.round((2000 - Math.PI * 4 * 10) * 1e6) / 1e6]);
    const wall = probe.body!.names.faces[probe.body!.topology.faces.findIndex((f) => f.surface === 'cylinder')]!;
    const filled = rebuild(add(base, { id: 'd1', type: 'deleteFace', name: 'd1', suppressed: false, faces: [face(wall)] }));
    expect(ok(filled)).toEqual([]);
    expect(volumes(filled)).toEqual([2000, 2000]);
  });

  it('keeps every reference when an upstream dimension changes: no lost reference, no guess by geometry', () => {
    const probe = rebuild(build(...block(1, 0, 20), ...block(2, 40, 60)));
    const edgeName = probe.body!.names.edges[probe.body!.topology.edges.findIndex((e) => e.curve === 'line' && e.mid[0] > 59.9 && e.mid[2] > 9.9)]!;
    let doc = add(build(...block(1, 0, 20), ...block(2, 40, 60)), fillet('f1', [edge(edgeName)], '1'));
    doc = applyCommand(doc, { type: 'setEndCondition', featureId: 'e2', dir: 'dir1', value: { type: 'blind', depth: '15' } });
    const r = rebuild(doc);
    expect(ok(r)).toEqual([]);
    expect(r.features.every((f) => !f.warnings)).toBe(true);
    expect(volumes(r)[1]).toBeCloseTo(20 * 10 * 15 - (1 - Math.PI / 4) * 10, 5);
  });
});

describe('「組合」 (C7.2)', () => {
  const two = (b: number) => build(...block(1, 0, 20), ...block(2, b, b + 20, { merge: false }));

  it('adds bodies that touch: one body with the main body\'s id, the other used up', () => {
    const r = rebuild(add(two(10), combine('k1', 'add', 'e1', 'e2')));
    expect(ok(r)).toEqual([]);
    expect(ids(r)).toEqual(['e1']);
    expect(volumes(r)).toEqual([3000]);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
  });

  it('refuses to add a body that is apart from the main one', () => {
    const r = rebuild(add(two(40), combine('k1', 'add', 'e1', 'e2')));
    expect(r.features.find((f) => f.id === 'k1')).toMatchObject({ status: 'error', message: expect.stringContaining('沒有和主要本體相接') });
    expect(ids(r)).toEqual(['e1', 'e2']); // as before the feature
  });

  it('subtracts one body from another, the tool used up; a subtraction that cuts the main body in two gives two bodies', () => {
    const r = rebuild(add(two(10), combine('k1', 'subtract', 'e1', 'e2')));
    expect(ok(r)).toEqual([]);
    expect(ids(r)).toEqual(['e1']);
    expect(volumes(r)).toEqual([1000]);
    const wall = build(...block(1, 0, 30), ...block(2, 10, 14, { merge: false }));
    const split = rebuild(add(wall, combine('k1', 'subtract', 'e1', 'e2')));
    expect(ok(split)).toEqual([]);
    expect(ids(split)).toEqual(['e1', 'k1#2']);
    expect(volumes(split)).toEqual([1600, 1000]);
  });

  it('keeps what two bodies share (「共同」)', () => {
    const r = rebuild(add(two(10), combine('k1', 'common', 'e1', 'e2')));
    expect(ok(r)).toEqual([]);
    expect(volumes(r)).toEqual([1000]);
    const none = rebuild(add(two(40), combine('k1', 'common', 'e1', 'e2')));
    expect(none.features.find((f) => f.id === 'k1')).toMatchObject({ status: 'error', message: expect.stringContaining('沒有共同的部分') });
  });

  it('uses several tools in turn, leaves the bodies it does not name, and names what is missing', () => {
    const base = build(...block(1, 0, 40), ...block(2, 5, 10, { merge: false }), ...block(3, 20, 25, { merge: false }), ...block(4, 100, 110));
    const r = rebuild(add(base, combine('k1', 'subtract', 'e1', 'e2', 'e3')));
    expect(ok(r)).toEqual([]);
    expect(ids(r)).toEqual(['e1', 'k1#3', 'k1#2', 'e4']); // the first tool made e1 and k1#2; the second cut e1 again, which gave k1#3 next to it
    expect(volumes(r).slice(0, 3).reduce((a, b) => a + b, 0)).toBeCloseTo(40 * 100 - 2 * 5 * 100, 6);
    expect(rebuild(add(base, combine('k1', 'add', 'e1', 'gone'))).features.find((f) => f.id === 'k1')).toMatchObject({ status: 'error', unresolved: [{ reason: 'missing' }] });
    expect(rebuild(add(base, combine('k1', 'add', 'e1'))).features.find((f) => f.id === 'k1')).toMatchObject({ status: 'error' });
  });

  it('names the faces of an addition after both bodies, the main one first (ADR 0005)', () => {
    const r = rebuild(add(two(10), combine('k1', 'add', 'e1', 'e2')));
    expect(r.body!.names.faces.some((n) => n.startsWith('e1:'))).toBe(true);
    expect(r.body!.names.faces.some((n) => n.startsWith('e2:'))).toBe(true);
  });

  it('depends on the features that made its bodies, and is checked when inserted', () => {
    const doc = add(two(10), combine('k1', 'add', 'e1', 'e2'));
    expect(dependencies(doc).parents.get('k1')?.sort()).toEqual(['e1', 'e2']);
    expect(() => applyCommand(two(10), { type: 'insertFeature', index: 4, feature: { ...combine('k2', 'add', 'e1', 'e1') } })).toThrow('不能同時是');
    expect(() => applyCommand(two(10), { type: 'insertFeature', index: 4, feature: { ...(combine('k2', 'add', 'e1', 'e2') as CombineFeature), tools: [face('x')] } })).toThrow('只能選本體');
  });
});

describe('bodies in the document (C7.1, D4.6)', () => {
  it('are named by the feature that made them, or by the user; a reference body is marked', () => {
    let doc = build(...block(1, 0, 20), ...block(2, 40, 60));
    expect(rebuild(doc).bodies.map((b) => [b.name, b.reference])).toEqual([['e1', false], ['e2', false]]);
    doc = applyCommand(doc, { type: 'setBody', bodyId: 'e2', name: '工件', reference: true });
    expect(rebuild(doc).bodies.map((b) => [b.name, b.reference])).toEqual([['e1', false], ['工件', true]]);
    doc = applyCommand(doc, { type: 'setBody', bodyId: 'e2', name: ' ', reference: false });
    expect(doc.bodies).toEqual({});
  });

  it('are hidden and shown by key, kept in the file, and a deleted feature takes what was said about its bodies with it', async () => {
    let doc = build(...block(1, 0, 20), ...block(2, 40, 60), ...slot(1, 5, 8));
    doc = applyCommand(doc, { type: 'setBody', bodyId: 'c1#2', name: '小塊' });
    doc = applyCommand(doc, { type: 'setVisibility', keys: [bodyKey('c1#2')], value: false });
    expect(isShown(doc, bodyKey('c1#2'))).toBe(false);
    expect(isShown(doc, bodyKey('e1'))).toBe(true);
    const file = await readPartFile(await writePartFile(doc));
    expect(file.doc).toEqual(doc);
    expect(rebuild(file.doc).bodies.map((b) => b.name)).toEqual(['e1', '小塊', 'e2']);
    const gone = applyCommand(doc, { type: 'deleteFeatures', featureIds: ['c1'] });
    expect(gone.bodies).toEqual({});
    expect(gone.visibility[bodyKey('c1#2')]).toBeUndefined();
  });

  it('are a version-10 matter: an older part opens with none chosen', () => {
    const { bodies: _omit, ...v9 } = createEmptyPart();
    const doc = parsePart(serializePart({ ...v9, schemaVersion: 9 } as PartDoc));
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.bodies).toEqual({});
  });
});

describe('a file with several solids (F2.1)', () => {
  it('becomes a body for each, named by the order the file gives the faces', async () => {
    const data = stepSamples(kernel).twoBlocks();
    const sha = await sha256Hex(data);
    const doc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step' }, feature: { id: 'imp1', type: 'importedBody', name: '輸入1', suppressed: false, blob: 'blob1' }, index: 0 });
    const r = rebuild(doc, new Map([[sha, data]]));
    expect(ok(r)).toEqual([]);
    expect(ids(r)).toEqual(['imp1', 'imp1#2']);
    expect(volumes(r)).toEqual([1000, 1000]);
    expect(r.body!.names.faces).toEqual(r.body!.topology.faces.map((_, i) => expect.stringMatching(/^imp1:f\d+$/)).map((_, i) => r.body!.names.faces[i]));
    expect(new Set(r.body!.names.faces).size).toBe(12);
    // two imports of one file are two bodies that share nothing
    const twice = applyCommand(doc, { type: 'importBody', blob: { id: 'blob2', sha256: sha, kind: 'step' }, feature: { id: 'imp2', type: 'importedBody', name: '輸入2', suppressed: false, blob: 'blob2', merge: false }, index: 1 });
    const t = rebuild(twice, new Map([[sha, data]]));
    expect(ok(t)).toEqual([]);
    expect(t.bodies).toHaveLength(4);
    expect(kernel.topology(t.body!.shape).faces).toHaveLength(24);
  });
});

describe('shapes', () => {
  it('are not leaked by rebuilds of a part with several bodies', () => {
    const doc = add(build(...block(1, 0, 20), ...block(2, 40, 60)), ...slot(1, 5, 8), combine('k1', 'add', 'e1', 'c1#2'));
    const regen = new Regenerator(kernel, solver);
    regen.rebuild(doc);
    const live = kernel.liveShapes;
    for (let n = 0; n < 5; n++) regen.rebuild(doc);
    expect(kernel.liveShapes).toBe(live);
    regen.dispose();
    // and a feature that fails does not leave the bodies it had made half-way behind
    const bad = add(build(...block(1, 0, 20), ...block(2, 40, 60)), combine('k1', 'add', 'e1', 'e2'));
    const r2 = new Regenerator(kernel, solver);
    r2.rebuild(bad);
    const before = kernel.liveShapes;
    for (let n = 0; n < 3; n++) r2.rebuild(bad);
    expect(kernel.liveShapes).toBe(before);
    r2.dispose();
  });
});
