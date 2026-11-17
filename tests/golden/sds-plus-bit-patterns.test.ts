/**
 * ADR 0257: a pattern of cuts on the drill bit. The body is a revolved part with helical flutes, so the material a cut took away shares nearly every face
 * with the body, which is where booleans between the two fail. Its own file for the same reason as sds-plus-bit.test.ts: each rebuild takes heap.
 *
 * Ground truth that does not come from the kernel: the neck is a cylinder about the bit's axis, so the engraving turned 180° about that axis meets the
 * same material and takes away the same volume.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type PartDoc } from '@3db/model';
import { readPartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, seedEffect } from '@3db/regen';
import { t } from '@3db/i18n';

let kernel: Kernel;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});

const open = async () => (await readPartFile(new Uint8Array(readFileSync(new URL('./sds-plus-bit.3dbx', import.meta.url))))).doc;
const after = (doc: PartDoc, id: string, feature: Feature) => applyCommand(doc, { type: 'insertFeature', index: doc.features.findIndex((f) => f.id === id) + 1, feature });
const turned = (id: string, seeds: string[]): Feature => ({ id, type: 'pattern', name: id, suppressed: false, seeds, def: { mode: 'circular', axis: { kind: 'datum', name: 'axBit' }, count: '2', angle: '360deg', equal: true } }) as Feature;
const upTo = (doc: PartDoc, last: string) => {
  const ids = doc.features.map((f) => f.id);
  return applyCommand(doc, { type: 'setSuppressed', featureIds: ids.slice(ids.indexOf(last) + 1), value: true });
};
const volume = (doc: PartDoc) => kernel.massProps(regen.rebuild(doc).body!.shape).volume;

describe('a pattern of cuts on a body whose cuts share its faces (ADR 0257)', () => {
  it('repeats the engraving by its tool, turned: the seed and the copy take away the same volume', async () => {
    const doc = after(await open(), 'cuText', turned('paText', ['cuText']));
    const r = regen.rebuild(doc);
    expect(r.features.filter((f) => f.status !== 'ok').map((f) => `${f.id}: ${f.message}`)).toEqual([]);
    const before = volume(upTo(doc, 'paGrooves'));
    const one = volume(upTo(doc, 'cuText'));
    const two = volume(doc);
    expect(before - one).toBeGreaterThan(1);
    expect(one - two).toBeCloseTo(before - one, 5);
  });

  it('when what the seeds did cannot be worked out, the pattern fails with the reason and the seed, which was built, stays built', async () => {
    // a chamfer may add or take away material, so both differences of the bodies are worked out, and on this body they fail
    const doc = after(await open(), 'chRelief', turned('paCh', ['chRelief']));
    const r = regen.rebuild(doc);
    expect(r.features.find((f) => f.id === 'chRelief')?.status).toBe('ok');
    const pattern = r.features.find((f) => f.id === 'paCh')!;
    expect(pattern.status).toBe('error');
    expect(pattern.message).toContain(t('pattern.deltaFailed', { why: '' }));
    // the rest of the part is built as without the pattern
    expect(r.features.filter((f) => f.id !== 'paCh' && f.status !== 'ok')).toEqual([]);
  });
});

describe('what a seed can do to the material (ADR 0257)', () => {
  const base = { id: 'x', name: 'x', suppressed: false, sketch: 's' };
  it('cuts and holes only take away, bosses only add, anything else may do both', () => {
    for (const type of ['extrude', 'revolve', 'sweep', 'loft', 'thread'] as const) {
      expect(seedEffect({ ...base, type, op: 'cut' } as unknown as Feature)).toBe('removes');
      expect(seedEffect({ ...base, type, op: 'boss' } as unknown as Feature)).toBe('adds');
    }
    expect(seedEffect({ ...base, type: 'hole' } as unknown as Feature)).toBe('removes');
    for (const type of ['fillet', 'chamfer', 'shell', 'moveFace', 'draft', 'combine'] as const) expect(seedEffect({ ...base, type } as unknown as Feature)).toBe('both');
  });
});
