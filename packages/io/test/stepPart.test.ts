import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDemoPart } from '@3db/model';
import { isStepData, readComponentFile, sha256Hex, stepAsPart, writePartFile } from '../src';

const step = new Uint8Array(readFileSync(new URL('../../../tests/fixtures/step/plate-with-hole.step', import.meta.url)));

describe('STEP files as parts (F2.1, C15.1)', () => {
  it('tells STEP data by its content', async () => {
    expect(isStepData(step)).toBe(true);
    expect(isStepData(await writePartFile(createDemoPart()))).toBe(false);
  });

  it('makes of a STEP file what 「開啟舊檔」 makes: one imported body, 「輸入1」', async () => {
    const part = await stepAsPart(step, 'plate-with-hole.step');
    const sha256 = await sha256Hex(step);
    expect(part.doc.blobs).toEqual([{ id: 'blob1', sha256, kind: 'step', fileName: 'plate-with-hole.step' }]);
    expect(part.doc.features).toEqual([{ id: 'import1', type: 'importedBody', name: '輸入1', suppressed: false, blob: 'blob1' }]);
    expect(part.blobs.get(sha256)).toBe(step);
  });

  it('reads either kind of file a component can use', async () => {
    expect((await readComponentFile(step, 'x.step')).doc.features[0]!.type).toBe('importedBody');
    expect((await readComponentFile(await writePartFile(createDemoPart()), 'x.3dbx')).doc).toEqual(createDemoPart());
  });
});
