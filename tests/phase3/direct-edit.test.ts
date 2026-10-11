/**
 * Phase 3a-2 (C10.1, C10.2): direct editing of a body. Delete Face takes a hole or a fillet out of a body
 * (native or imported) and Move Face pushes a planar face. Both keep the names of the faces they leave alone,
 * so what comes after them stays where the user put it (ADR 0021).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, parsePart, SCHEMA_VERSION, serializePart, type Feature, type PartDoc } from '@3db/model';
import { readPartFile, sha256Hex, writePartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { dependencies, Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, edge, extrude, face, fillet, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const W = 40;
const D = 30;
const H = 10;
const R = 4;
const BLOCK = W * D * H;
const HOLE = Math.PI * R * R * H;

/** A 40 × 30 × 10 plate with an R4 hole through it. */
const plate = (): Feature[] => [
  sketch('s1', front, rectangle('a', 0, 0, W, D)),
  extrude('e1', 's1', 'boss', { type: 'blind', depth: String(H) }),
  sketch('s2', front, circle('k', 20, 15, R)),
  extrude('c1', 's2', 'cut', { type: 'throughAll', reverse: true }),
];
const add = (doc: PartDoc, ...features: Feature[]) => features.reduce((d, feature) => applyCommand(d, { type: 'insertFeature', feature, index: d.features.length }), doc);
const deleteFace = (id: string, ...faces: string[]): Feature => ({ id, type: 'deleteFace', name: id, suppressed: false, faces: faces.map(face) });
const moveFace = (id: string, name: string, distance: string): Feature => ({ id, type: 'moveFace', name: id, suppressed: false, face: face(name), distance });

const rebuild = (doc: PartDoc, blobs = new Map<string, Uint8Array>()) => new Regenerator(kernel, solver, blobs).rebuild(doc);
const volume = (r: RebuildResult) => kernel.massProps(r.body!.shape).volume;
const nameOf = (r: RebuildResult, test: (f: NonNullable<RebuildResult['body']>['topology']['faces'][number]) => boolean) => {
  const i = r.body!.topology.faces.findIndex(test);
  expect(i).toBeGreaterThanOrEqual(0);
  return r.body!.names.faces[i]!;
};
const wall = (r: RebuildResult) => nameOf(r, (f) => f.surface === 'cylinder');
const top = (r: RebuildResult) => nameOf(r, (f) => !!f.normal && f.normal[2] > 0.9);
const valid = (r: RebuildResult) => kernel.isValid(r.body!.shape);

describe('delete face (C10.2)', () => {
  it('takes the hole out of a plate: volume, validity and the names of the faces left', () => {
    const base = rebuild(build(...plate()));
    const wallName = wall(base);
    const topName = top(base);
    const doc = add(build(...plate()), deleteFace('d1', wallName));
    const r = rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 's2=ok', 'c1=ok', 'd1=ok']);
    expect(volume(r)).toBeCloseTo(BLOCK, 6);
    expect(valid(r)).toBe(true);
    expect(r.body!.topology.faces).toHaveLength(6);
    expect(r.features.every((f) => !f.warnings)).toBe(true);
    // the top face is still the top face it was, though its hole is gone
    expect(top(r)).toBe(topName);
    expect(r.body!.names.faces).not.toContain(wallName);
    expect(dependencies(doc).parents.get('d1')).toEqual(['c1']);
  });

  it('what is built on a face that survives still works: a boss on the top face after the hole is gone', () => {
    const topName = top(rebuild(build(...plate())));
    const doc = add(build(...plate()), deleteFace('d1', wall(rebuild(build(...plate())))), sketch('s3', face(topName), circle('m', 8, 8, 3)), extrude('e2', 's3', 'boss', { type: 'blind', depth: '5' }));
    const r = rebuild(doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(volume(r)).toBeCloseTo(BLOCK + Math.PI * 9 * 5, 5);
  });

  it('「刪除鑽孔」 takes the bottom of a blind hole with its wall; without it the bottom is left and the feature fails', () => {
    const blind = [...plate().slice(0, 3), extrude('c1', 's2', 'cut', { type: 'blind', depth: '4', reverse: true })];
    const base = rebuild(build(...blind));
    expect(volume(base)).toBeCloseTo(BLOCK - Math.PI * R * R * 4, 6);
    const wallName = wall(base);
    const alone = rebuild(add(build(...blind), deleteFace('d1', wallName)));
    expect(alone.features.find((f) => f.id === 'd1')!.status).toBe('error');
    const withHole = rebuild(add(build(...blind), { ...deleteFace('d1', wallName), hole: true } as Feature));
    expect(statuses(withHole).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(volume(withHole)).toBeCloseTo(BLOCK, 6);
    expect(withHole.body!.topology.faces).toHaveLength(6);
    // the command carries the intent, and takes it back
    const doc = applyCommand(add(build(...blind), deleteFace('d1', wallName)), { type: 'setFaces', featureId: 'd1', faces: [face(wallName)], hole: true });
    expect((doc.features[4] as Extract<Feature, { type: 'deleteFace' }>).hole).toBe(true);
    expect('hole' in (applyCommand(doc, { type: 'setFaces', featureId: 'd1', faces: [face(wallName)] }).features[4] as object)).toBe(false);
  });

  it('「刪除鑽孔」 takes the chamfer at the mouth of the hole with it, and leaves the other chamfers alone', () => {
    const probe = rebuild(build(...plate()));
    const circleAt = (z: number) => probe.body!.topology.edges.findIndex((e) => e.curve === 'circle' && Math.abs(e.mid[2] - z) < 1e-6);
    const rimEdge = probe.body!.names.edges[circleAt(H)]!;
    const outerEdge = probe.body!.topology.edges.findIndex((e) => e.curve === 'line' && e.mid[2] > H - 1e-6 && e.mid[0] > W - 1e-6);
    const chamfered = add(build(...plate()), { id: 'ch1', type: 'chamfer', name: 'ch1', suppressed: false, edges: [edge(rimEdge), edge(probe.body!.names.edges[outerEdge]!)], mode: 'distanceDistance', distance: '1', second: '1' } as Feature);
    const before = rebuild(chamfered);
    expect(statuses(before).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    const cone = nameOf(before, (f) => f.surface === 'cone');
    expect(before.body!.topology.faces.filter((f) => f.surface === 'cone' || f.surface === 'plane').length).toBeGreaterThan(6);
    const r = rebuild(add(chamfered, { ...deleteFace('d1', wall(before)), hole: true } as Feature));
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(r.body!.names.faces).not.toContain(cone);
    // the hole and its chamfer are gone (6 faces + the outer edge's chamfer = 7), the outer chamfer is still there
    expect(r.body!.topology.faces).toHaveLength(7);
    expect(volume(r)).toBeCloseTo(BLOCK - 0.5 * D, 6); // the block less the outer 1 × 1 chamfer along its 30 mm edge
  });

  it('takes a fillet off: the edge is square again', () => {
    const probe = rebuild(build(...plate()));
    const i = probe.body!.topology.edges.findIndex((e) => e.curve === 'line' && e.mid[0] > W - 1e-6 && e.mid[2] > H - 1e-6);
    const doc = add(build(...plate().slice(0, 2)), fillet('f1', [edge(probe.body!.names.edges[i]!)], '3'));
    const rounded = rebuild(doc);
    expect(volume(rounded)).toBeLessThan(BLOCK);
    const r = rebuild(add(doc, deleteFace('d1', wall(rounded))));
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(volume(r)).toBeCloseTo(BLOCK, 6);
    expect(r.body!.topology.faces).toHaveLength(6);
  });

  it('takes the hole out of an imported body, faces named by their file order', async () => {
    const step = new TextEncoder().encode(kernel.exportStep(rebuild(build(...plate())).body!.shape, 'Plate'));
    const sha = await sha256Hex(step);
    const imported = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step' }, feature: { id: 'imp1', type: 'importedBody', name: '輸入1', suppressed: false, blob: 'blob1' }, index: 0 });
    const blobs = new Map([[sha, step]]);
    const probe = rebuild(imported, blobs);
    const holeName = wall(probe);
    expect(holeName).toMatch(/^imp1:f\d+$/);
    const topName = top(probe);
    const doc = add(imported, deleteFace('d1', holeName), sketch('s1', face(topName), circle('m', 8, 8, 3)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '5' }));
    const r = rebuild(doc, blobs);
    expect(statuses(r)).toEqual(['imp1=ok', 'd1=ok', 's1=ok', 'e1=ok']);
    expect(volume(r)).toBeCloseTo(BLOCK + Math.PI * 9 * 5, 5);
    expect(dependencies(doc).parents.get('d1')).toEqual(['imp1']);
    expect(dependencies(doc).parents.get('s1')).toEqual(['imp1']);
  });

  it('reports a face that cannot be removed as an error of the feature, and the rest carries on', () => {
    const topName = top(rebuild(build(...plate())));
    const doc = add(build(...plate()), deleteFace('d1', topName), sketch('s3', face(topName), circle('m', 8, 8, 3)));
    const r = rebuild(doc);
    expect(r.features.find((f) => f.id === 'd1')).toMatchObject({ status: 'error', message: expect.stringContaining('刪除面失敗') });
    expect(r.features.find((f) => f.id === 's3')!.status).toBe('ok');
    expect(volume(r)).toBeCloseTo(BLOCK - HOLE, 6); // the body is as it was before the failed feature
  });

  it('says which face is lost when the name and the geometry both fail', () => {
    const doc = add(build(...plate()), { id: 'd1', type: 'deleteFace', name: 'd1', suppressed: false, faces: [face('c1:side:s2.gone')] });
    const d = rebuild(doc).features.find((x) => x.id === 'd1')!;
    expect(d).toMatchObject({ status: 'error', message: expect.stringContaining('遺失參考') });
    expect(d.unresolved).toHaveLength(1);
  });
});

describe('move face (C10.1)', () => {
  it.each([5, -3])('moves the top face of the plate by %d, and the hole follows', (d) => {
    const topName = top(rebuild(build(...plate())));
    const doc = add(build(...plate()), moveFace('m1', topName, String(d)));
    const r = rebuild(doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(volume(r)).toBeCloseTo((W * D - Math.PI * R * R) * (H + d), 6);
    expect(valid(r)).toBe(true);
    expect(top(r)).toBe(topName); // the moved face keeps its name
    expect(r.features.every((f) => !f.warnings)).toBe(true);
  });

  it('keeps what was built on the face with it: a fillet on an edge of the top, made after the move', () => {
    const base = rebuild(build(...plate()));
    const topName = top(base);
    const moved = add(build(...plate()), moveFace('m1', topName, '5'));
    const probe = rebuild(moved);
    const i = probe.body!.topology.edges.findIndex((e) => e.curve === 'line' && e.mid[0] > W - 1e-6 && e.mid[2] > H + 5 - 1e-6);
    const r = rebuild(add(moved, fillet('f1', [edge(probe.body!.names.edges[i]!)], '2')));
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(volume(r)).toBeCloseTo((W * D - Math.PI * R * R) * (H + 5) - (4 - Math.PI) * D, 5);
  });

  it('is driven by an expression: a variable, and a change of the variable moves the face again', () => {
    const topName = top(rebuild(build(...plate())));
    let doc = applyCommand(build(...plate()), { type: 'addVariable', variable: { id: 'v1', name: 'lift', expr: '2' } });
    doc = add(doc, moveFace('m1', topName, 'lift*2'));
    expect(volume(rebuild(doc))).toBeCloseTo((W * D - Math.PI * R * R) * (H + 4), 6);
    doc = applyCommand(doc, { type: 'setVariable', id: 'v1', expr: '3' });
    expect(volume(rebuild(doc))).toBeCloseTo((W * D - Math.PI * R * R) * (H + 6), 6);
    // a variable that makes the distance zero is not refused (it may be used elsewhere); the feature says so when it is built
    const zero = applyCommand(doc, { type: 'setVariable', id: 'v1', expr: '0' });
    expect(rebuild(zero).features.find((f) => f.id === 'm1')).toMatchObject({ status: 'error', message: expect.stringContaining('不能是 0') });
    expect(() => applyCommand(doc, { type: 'setMoveFace', featureId: 'm1', face: face(topName), distance: '0' })).toThrow('不能是 0');
  });

  it('follows a change upstream: the plate is made thicker and the face is still found by its name', () => {
    const topName = top(rebuild(build(...plate())));
    const doc = applyCommand(add(build(...plate()), moveFace('m1', topName, '5')), { type: 'setEndCondition', featureId: 'e1', dir: 'dir1', value: { type: 'blind', depth: '15' } });
    const r = rebuild(doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(volume(r)).toBeCloseTo((W * D - Math.PI * R * R) * 20, 6);
    expect(r.features.every((f) => !f.warnings)).toBe(true);
  });

  it('refuses a face with a smooth neighbour as the feature’s error, with the way out', () => {
    const probe = rebuild(build(...plate().slice(0, 2)));
    const i = probe.body!.topology.edges.findIndex((e) => e.curve === 'line' && e.mid[0] > W - 1e-6 && e.mid[2] > H - 1e-6);
    const base = add(build(...plate().slice(0, 2)), fillet('f1', [edge(probe.body!.names.edges[i]!)], '3'));
    const r = rebuild(add(base, moveFace('m1', top(rebuild(base)), '2')));
    expect(r.features.find((f) => f.id === 'm1')).toMatchObject({ status: 'error', message: expect.stringContaining('相切') });
    expect(volume(r)).toBeCloseTo(volume(rebuild(base)), 9);
  });

  it('refuses a face that is not a plane', () => {
    const r = rebuild(add(build(...plate()), moveFace('m1', wall(rebuild(build(...plate()))), '1')));
    expect(r.features.find((f) => f.id === 'm1')).toMatchObject({ status: 'error', message: expect.stringContaining('平面') });
  });
});

describe('the two features in the document', () => {
  it('check their references when they are inserted', () => {
    const doc = build(...plate());
    expect(() => applyCommand(doc, { type: 'insertFeature', index: 4, feature: { id: 'd1', type: 'deleteFace', name: 'd1', suppressed: false, faces: [edge('x')] } })).toThrow('只能選面');
    expect(() => applyCommand(doc, { type: 'insertFeature', index: 4, feature: { id: 'm1', type: 'moveFace', name: 'm1', suppressed: false, face: edge('x'), distance: '1' } })).toThrow('一個面');
    expect(() => applyCommand(doc, { type: 'setFaces', featureId: 'e1', faces: [] })).toThrow('刪除面特徵');
  });

  it('are edited by their own commands, and replaceRef repairs a lost face', () => {
    const probe = rebuild(build(...plate()));
    const wallName = wall(probe);
    const f = probe.body!.topology.faces.find((x) => x.surface === 'cylinder')!;
    // the name is gone but the reference still remembers where the face was
    const lostWall = { kind: 'face' as const, name: 'c1:side:s2.gone', fingerprint: { type: 'cylinder', size: f.area, center: f.center } };
    let doc = add(build(...plate()), { id: 'd1', type: 'deleteFace', name: 'd1', suppressed: false, faces: [lostWall] });
    const candidate = rebuild(doc).features.find((f) => f.id === 'd1')!.unresolved![0]!.candidates[0]!;
    expect(candidate.name).toBe(wallName);
    doc = applyCommand(doc, { type: 'replaceRef', featureId: 'd1', from: lostWall, to: { kind: 'face', name: candidate.name, fingerprint: candidate.fingerprint } });
    expect(rebuild(doc).features.find((f) => f.id === 'd1')!.status).toBe('ok');
    doc = applyCommand(doc, { type: 'setFaces', featureId: 'd1', faces: [face(wallName), face(wallName)] });
    expect((doc.features[4] as Extract<Feature, { type: 'deleteFace' }>).faces).toHaveLength(2);
  });

  it('suppressing the face before takes them out with it; unsuppressing brings them back', () => {
    const wallName = wall(rebuild(build(...plate())));
    const doc = add(build(...plate()), deleteFace('d1', wallName));
    const suppressed = applyCommand(doc, { type: 'setSuppressed', featureIds: ['d1'], value: true });
    expect(volume(rebuild(suppressed))).toBeCloseTo(BLOCK - HOLE, 6);
    expect(volume(rebuild(applyCommand(suppressed, { type: 'setSuppressed', featureIds: ['d1'], value: false })))).toBeCloseTo(BLOCK, 6);
  });

  it('survive the part file and come back the same', async () => {
    const topName = top(rebuild(build(...plate())));
    const doc = add(build(...plate()), deleteFace('d1', wall(rebuild(build(...plate())))), moveFace('m1', topName, '5'));
    const before = rebuild(doc);
    const file = await readPartFile(await writePartFile(doc, new Map()));
    expect(file.warnings).toEqual([]);
    expect(file.doc).toEqual(doc);
    const after = rebuild(file.doc);
    expect(statuses(after)).toEqual(statuses(before));
    expect(after.body!.names.faces).toEqual(before.body!.names.faces);
    expect(volume(after)).toBeCloseTo(volume(before), 9);
    expect(parsePart(serializePart(doc)).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('do not leak shapes and preserve WASM heap across repeated moveFace rebuilds', () => {
    const topName = top(rebuild(build(...plate())));
    const doc = add(build(...plate()), deleteFace('d1', wall(rebuild(build(...plate())))), moveFace('m1', topName, '5'));
    const regen = new Regenerator(kernel, solver);
    regen.rebuild(doc);
    const live = kernel.liveShapes;
    const initialHeapBytes = (kernel.oc as any).HEAPU8?.byteLength ?? 0;
    for (let n = 0; n < 20; n++) {
      regen.rebuild(doc);
    }
    expect(kernel.liveShapes).toBe(live);
    const finalHeapBytes = (kernel.oc as any).HEAPU8?.byteLength ?? 0;
    expect(finalHeapBytes, 'WASM heap should not grow across repeated moveFace operations').toBe(initialHeapBytes);
    regen.dispose();
  });
});
