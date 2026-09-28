/**
 * Phase 1F (handoff §9): STEP import (F2.1). A part exported by this program stands in for a
 * SolidWorks STEP until the user's samples arrive: import it, add features on its faces and edges,
 * export it again, and keep the part — data included — in the part file.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, CommandError, DocHistory, type BlobRef, type Feature, type PartDoc } from '@3db/model';
import { readPartFile, sha256Hex, writePartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { dependencies, Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, edge, extrude, face, fillet, front, rectangle, sketch, statuses } from './builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
/** A 40 × 30 × 10 plate with an R4 through hole, as STEP text written by this program. */
let plateStep: Uint8Array;
let plateSha: string;
const PLATE = 40 * 30 * 10 - Math.PI * 16 * 10;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  const regen = new Regenerator(kernel, solver);
  const r = regen.rebuild(
    build(
      sketch('s1', front, rectangle('a', 0, 0, 40, 30)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
      sketch('s2', front, circle('k', 20, 15, 4)),
      extrude('c1', 's2', 'cut', { type: 'throughAll', reverse: true }),
    ),
  );
  plateStep = new TextEncoder().encode(kernel.exportStep(r.body!.shape, 'Plate'));
  plateSha = await sha256Hex(plateStep);
  regen.dispose();
});

const blob = (id = 'blob1', sha256 = plateSha): BlobRef => ({ id, sha256, kind: 'step', fileName: 'plate.step' });
const imported = (id = 'imp1', blobId = 'blob1'): Extract<Feature, { type: 'importedBody' }> => ({ id, type: 'importedBody', name: '輸入1', suppressed: false, blob: blobId });
/** A part whose first feature imports the plate; `then` are added after it. */
function withPlate(...then: Feature[]): PartDoc {
  const doc = applyCommand(createEmptyPart(), { type: 'importBody', blob: blob(), feature: imported(), index: 0 });
  return then.reduce((d, feature) => applyCommand(d, { type: 'insertFeature', feature, index: d.features.length }), doc);
}
const regenerator = (blobs = new Map([[plateSha, plateStep]])) => new Regenerator(kernel, solver, blobs);
const volume = (r: RebuildResult) => kernel.massProps(r.body!.shape).volume;
/** Imported faces are named by their order in the file; tests pick them by geometry. */
function importedFace(r: RebuildResult, test: (f: RebuildResult['body'] extends infer B ? (B extends { topology: { faces: (infer F)[] } } ? F : never) : never) => boolean): string {
  const i = r.body!.topology.faces.findIndex(test);
  expect(i).toBeGreaterThanOrEqual(0);
  return r.body!.names.faces[i]!;
}

describe('importing a STEP part (F2.1)', () => {
  it('rebuilds the solid from the document data and names its faces by file order', () => {
    const r = regenerator().rebuild(withPlate());
    expect(statuses(r)).toEqual(['imp1=ok']);
    expect(volume(r)).toBeCloseTo(PLATE, 6);
    expect(r.body!.names.faces).toEqual(r.body!.topology.faces.map((_, i) => `imp1:f${i + 1}`));
    expect(r.body!.names.edges.filter((e) => !/^\{imp1:f\d+(\|imp1:f\d+)?\}(#\d+)?$/.test(e))).toEqual([]); // a seam borders one face
    expect(dependencies(withPlate()).parents.get('imp1')).toEqual([]);
  });

  it('carries features on its faces and edges: a boss on the top face, a fillet on a top edge', () => {
    const regen = regenerator();
    const top = importedFace(regen.rebuild(withPlate()), (f) => f.surface === 'plane' && f.center[2] > 9.99);
    const probe = regen.rebuild(withPlate());
    const i = probe.body!.topology.edges.findIndex((e) => e.curve === 'line' && e.mid[0] > 39.99 && e.mid[2] > 9.99); // top edge at x = 40
    const edgeName = probe.body!.names.edges[i]!;
    const doc = withPlate(
      sketch('s1', face(top), circle('m', 8, 8, 3)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '5' }),
      fillet('f1', [edge(edgeName)], '2'),
    );
    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['imp1=ok', 's1=ok', 'e1=ok', 'f1=ok']);
    expect(volume(r)).toBeCloseTo(PLATE + Math.PI * 9 * 5 - (4 - Math.PI) * 30, 5);
    expect(dependencies(doc).parents.get('s1')).toEqual(['imp1']);
    expect(dependencies(doc).parents.get('f1')).toEqual(['imp1']);

    // Import → add features → export → import: the geometry survives the round trip.
    const back = kernel.importStep(kernel.exportStep(r.body!.shape, 'Plate'));
    try {
      expect(kernel.massProps(back.shape).volume).toBeCloseTo(volume(r), 6);
    } finally {
      kernel.release(back.shape);
    }
  });

  it('adds an imported part to the body that is already there', () => {
    const doc = applyCommand(
      build(sketch('s1', front, rectangle('b', 0, 0, 10, 10)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' })),
      { type: 'importBody', blob: blob(), feature: imported(), index: 2 },
    );
    const r = regenerator().rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 'imp1=ok']);
    expect(volume(r)).toBeCloseTo(PLATE + 10 * 10 * 10, 5); // the block sticks 10 mm out of the plate
    expect(r.body!.names.faces.some((n) => n.startsWith('imp1:f'))).toBe(true);
    expect(r.body!.names.faces.some((n) => n.startsWith('e1:'))).toBe(true);
  });

  it('reads each file once and keeps it across rebuilds', () => {
    let reads = 0;
    const regen = new Regenerator(kernel, solver, { get: (sha) => (reads++, sha === plateSha ? plateStep : undefined) });
    const a = volume(regen.rebuild(withPlate()));
    const b = volume(regen.rebuild(withPlate()));
    expect(a).toBe(b);
    expect(reads).toBe(1);
    const live = kernel.liveShapes;
    for (let n = 0; n < 5; n++) regen.rebuild(withPlate());
    expect(kernel.liveShapes).toBe(live); // no shape is leaked per rebuild
  });

  it('says what is wrong when the data is missing or is not a STEP solid', async () => {
    expect(regenerator(new Map()).rebuild(withPlate()).features[0]).toMatchObject({ status: 'error', message: expect.stringContaining('找不到輸入的資料') });
    const text = new TextEncoder().encode('not a step file');
    const sha = await sha256Hex(text);
    const doc = applyCommand(createEmptyPart(), { type: 'importBody', blob: blob('blob1', sha), feature: imported(), index: 0 });
    expect(regenerator(new Map([[sha, text]])).rebuild(doc).features[0]).toMatchObject({ status: 'error', message: expect.stringContaining('STEP') });
  });
});

describe('imported data in the document', () => {
  it('adds the data and the feature in one undoable step, and drops the data with the feature', () => {
    const history = new DocHistory(createEmptyPart());
    history.execute({ type: 'importBody', blob: blob(), feature: imported(), index: 0 });
    expect(history.doc.blobs).toEqual([blob()]);
    expect(history.doc.features.map((f) => f.id)).toEqual(['imp1']);
    history.undo();
    expect(history.doc.blobs).toEqual([]);
    expect(history.doc.features).toEqual([]);
    history.redo();
    history.execute({ type: 'deleteFeatures', featureIds: ['imp1'] });
    expect(history.doc.blobs).toEqual([]);
    expect(history.doc.idCounters).toMatchObject({ blob: 1, imp: 1 }); // never issued again
  });

  it('refuses a feature without its data, and data that is not a SHA-256', () => {
    expect(() => applyCommand(createEmptyPart(), { type: 'insertFeature', feature: imported(), index: 0 })).toThrow(CommandError);
    expect(() => applyCommand(createEmptyPart(), { type: 'importBody', blob: blob('blob1', 'abc'), feature: imported(), index: 0 })).toThrow('雜湊值');
    expect(() => applyCommand(createEmptyPart(), { type: 'importBody', blob: blob('blob1'), feature: imported('imp1', 'blob2'), index: 0 })).toThrow(CommandError);
  });

  it('keeps the data in the part file: a fresh program rebuilds the same names and volume', async () => {
    const doc = withPlate(fillet('f1', [edge('{imp1:f1|imp1:f2}')], '1'));
    const before = regenerator().rebuild(doc);
    const names = before.body!.names.faces;
    const v = volume(before);
    const file = await readPartFile(await writePartFile(doc, new Map([[plateSha, plateStep]])));
    expect(file.warnings).toEqual([]);
    expect(file.blobs.get(plateSha)).toEqual(plateStep);
    const after = new Regenerator(kernel, solver, file.blobs).rebuild(file.doc);
    expect(statuses(after)).toEqual(statuses(before));
    expect(after.body!.names.faces).toEqual(names);
    expect(volume(after)).toBeCloseTo(v, 9);
  });
});

describe('a fixed STEP file (golden)', () => {
  it('names the same faces the same way: a reader that reorders faces must fail here, not in parts', async () => {
    const data = new Uint8Array(readFileSync(new URL('../fixtures/step/plate-with-hole.step', import.meta.url)));
    const sha = await sha256Hex(data);
    const doc = applyCommand(createEmptyPart(), { type: 'importBody', blob: blob('blob1', sha), feature: imported(), index: 0 });
    const r = regenerator(new Map([[sha, data]])).rebuild(doc);
    const round = (c: number) => Math.round(c * 1000) / 1000 + 0; // + 0 turns -0 into 0
    const faces = r.body!.names.faces.map((name, i) => {
      const f = r.body!.topology.faces[i]!;
      return [name, f.surface, f.center.map(round)];
    });
    expect(faces).toEqual([
      ['imp1:f1', 'plane', [20, 0, 5]],
      ['imp1:f2', 'plane', [0, 15, 5]],
      ['imp1:f3', 'plane', [40, 15, 5]],
      ['imp1:f4', 'plane', [20, 15, 0]],
      ['imp1:f5', 'plane', [20, 15, 10]],
      ['imp1:f6', 'plane', [20, 30, 5]],
      ['imp1:f7', 'cylinder', [20, 15, 5]],
    ]);
    expect(r.features[0]!.warnings).toBeUndefined();
    expect(volume(r)).toBeCloseTo(PLATE, 6);
  });
});
