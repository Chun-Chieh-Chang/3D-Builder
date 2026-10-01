/**
 * Phase 3a-2 (F2.2, A1.7): a defective STEP file in a part. The report of what was found and done reaches the
 * feature's result, a gap wider than the default is closed by a setting stored with the feature, and what is built on
 * the sewn solid keeps working (the faces are named by the order the file gives them, deterministic after sewing).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type BlobRef, type Feature, type PartDoc } from '@3db/model';
import { readPartFile, sha256Hex, writePartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { stepSamples, type StepSamples } from '../support/stepSamples';
import { circle, extrude, face, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
let samples: StepSamples;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  samples = stepSamples(kernel);
});

/** A part that imports `data`, with `then` after it. */
async function partWith(data: Uint8Array, ...then: Feature[]): Promise<{ doc: PartDoc; blobs: Map<string, Uint8Array> }> {
  const sha256 = await sha256Hex(data);
  const blob: BlobRef = { id: 'blob1', sha256, kind: 'step', fileName: 'sample.step' };
  let doc = applyCommand(createEmptyPart(), { type: 'importBody', blob, feature: { id: 'imp1', type: 'importedBody', name: '輸入1', suppressed: false, blob: 'blob1' }, index: 0 });
  for (const feature of then) doc = applyCommand(doc, { type: 'insertFeature', feature, index: doc.features.length });
  return { doc, blobs: new Map([[sha256, data]]) };
}
const rebuild = (doc: PartDoc, blobs: Map<string, Uint8Array>) => new Regenerator(kernel, solver, blobs).rebuild(doc);
const volume = (r: RebuildResult) => kernel.massProps(r.body!.shape).volume;
const imp = (r: RebuildResult) => r.features.find((f) => f.id === 'imp1')!;

describe('a file with surfaces and no solid', () => {
  it('becomes a solid, and the feature carries the report', async () => {
    const { doc, blobs } = await partWith(samples.facesOnly());
    const r = rebuild(doc, blobs);
    expect(statuses(r)).toEqual(['imp1=ok']);
    expect(volume(r)).toBeCloseTo(samples.volume, 6);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(imp(r).diagnostics).toMatchObject({ solids: 0, faces: 6, sewn: true, freeEdges: 0, validAfter: true });
    expect(imp(r).warnings).toEqual([expect.stringContaining('縫合成 1 個實體')]);
    expect(r.body!.names.faces).toEqual(r.body!.topology.faces.map((_, i) => `imp1:f${i + 1}`));
  });

  it('can be built on: a boss on its top face, a hole through it taken out by Delete Face, a face moved', async () => {
    const probe = await partWith(samples.facesOnly());
    const base = rebuild(probe.doc, probe.blobs);
    const topName = base.body!.names.faces[base.body!.topology.faces.findIndex((f) => f.normal && f.normal[2] > 0.9)]!;
    const { doc, blobs } = await partWith(
      samples.facesOnly(),
      sketch('s1', face(topName), circle('m', 5, 5, 2)),
      extrude('e1', 's1', 'cut', { type: 'blind', depth: '3' }),
      { id: 'd1', type: 'deleteFace', name: 'd1', suppressed: false, faces: [face('e1:side:s1.m')], hole: true },
      { id: 'm1', type: 'moveFace', name: 'm1', suppressed: false, face: face(topName), distance: '2' },
    );
    const r = rebuild(doc, blobs);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    // the blind hole is gone (wall and bottom), and the top is two higher: the block is 20 × 10 × 7
    expect(volume(r)).toBeCloseTo(20 * 10 * 7, 6);
  });

  it('keeps its report and its names through the part file', async () => {
    const { doc, blobs } = await partWith(samples.facesOnly());
    const before = rebuild(doc, blobs);
    const file = await readPartFile(await writePartFile(doc, blobs));
    expect(file.warnings).toEqual([]);
    const after = rebuild(file.doc, file.blobs);
    expect(after.body!.names.faces).toEqual(before.body!.names.faces);
    expect(imp(after).diagnostics).toEqual(imp(before).diagnostics);
    expect(volume(after)).toBeCloseTo(volume(before), 9);
  });
});

describe('a gap wider than the default', () => {
  it('is an error of the feature that says what to do; a sewing tolerance stored with it closes the gap', async () => {
    const { doc, blobs } = await partWith(samples.gapped(0.05));
    const failed = imp(rebuild(doc, blobs));
    expect(failed.status).toBe('error');
    expect(failed.message).toMatch(/仍有 \d+ 條邊沒有接上.*加大縫合容差/);

    const wider = applyCommand(doc, { type: 'setImportOptions', featureId: 'imp1', sewTolerance: '0.1' });
    const r = rebuild(wider, blobs);
    expect(imp(r).status).toBe('ok');
    expect(imp(r).diagnostics).toMatchObject({ sewn: true, sewTolerance: 0.1, freeEdges: 0 });
    expect(Math.abs(volume(r) - samples.volume)).toBeLessThan(10);
  });

  it('takes the tolerance from an expression, and a change of the variable is a new sewing', async () => {
    const { doc, blobs } = await partWith(samples.gapped(0.05));
    let d = applyCommand(doc, { type: 'addVariable', variable: { id: 'v1', name: 'seam', expr: '0.2' } });
    d = applyCommand(d, { type: 'setImportOptions', featureId: 'imp1', sewTolerance: 'seam/2' });
    const regen = new Regenerator(kernel, solver, blobs);
    expect(regen.rebuild(d).features[0]!.diagnostics?.sewTolerance).toBeCloseTo(0.1, 12);
    d = applyCommand(d, { type: 'setVariable', id: 'v1', expr: '0.02' }); // 0.01: too small for the gap again
    expect(regen.rebuild(d).features[0]).toMatchObject({ status: 'error' });
    regen.dispose();
  });

  it('refuses a tolerance that is not a positive length, and the option is only for imported bodies', async () => {
    const { doc } = await partWith(samples.gapped(0.05), sketch('s1', { kind: 'datum', name: 'plane:front' }, circle('m', 5, 5, 2)));
    expect(() => applyCommand(doc, { type: 'setImportOptions', featureId: 'imp1', sewTolerance: '0' })).toThrow('必須大於 0');
    expect(() => applyCommand(doc, { type: 'setImportOptions', featureId: 's1', sewTolerance: '1' })).toThrow('輸入本體');
    expect('sewTolerance' in applyCommand(applyCommand(doc, { type: 'setImportOptions', featureId: 'imp1', sewTolerance: '1' }), { type: 'setImportOptions', featureId: 'imp1' }).features[0]!).toBe(false);
  });

  it('does not keep the old sewing around when the tolerance changes', async () => {
    const { doc, blobs } = await partWith(samples.gapped(0.05));
    const regen = new Regenerator(kernel, solver, blobs);
    const a = applyCommand(doc, { type: 'setImportOptions', featureId: 'imp1', sewTolerance: '0.1' });
    regen.rebuild(a);
    const live = kernel.liveShapes;
    regen.rebuild(a);
    expect(kernel.liveShapes).toBe(live);
    regen.rebuild(applyCommand(a, { type: 'setImportOptions', featureId: 'imp1', sewTolerance: '0.2' }));
    expect(kernel.liveShapes).toBe(live); // the 0.1 sewing was let go, not added to
    regen.dispose();
  });
});

describe('a file that is not a closed volume', () => {
  it('says how many edges stayed open, and the diagnostics are absent because nothing was built', async () => {
    const { doc, blobs } = await partWith(samples.openBox());
    const r = rebuild(doc, blobs);
    expect(imp(r)).toMatchObject({ status: 'error', message: expect.stringContaining('仍有 4 條邊沒有接上') });
    expect(imp(r).diagnostics).toBeUndefined();
    expect(r.body).toBeNull();
  });

  it('a stray face beside a solid is left out and counted in the report', async () => {
    const { doc, blobs } = await partWith(samples.blockWithStrayFace());
    const r = rebuild(doc, blobs);
    expect(imp(r).status).toBe('ok');
    expect(imp(r).diagnostics).toMatchObject({ looseFaces: 1 });
    expect(volume(r)).toBeCloseTo(125, 6);
  });
});
