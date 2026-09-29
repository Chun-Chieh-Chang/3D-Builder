import { applyCommand, createEmptyPart } from '@3db/model';
import { readPartFile, sha256Hex, type PartFile } from './partFile';

/** Whether the bytes are a STEP file (ISO 10303-21), whatever the file is called. */
export function isStepData(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, 64)).trimStart().startsWith('ISO-10303-21');
}

/**
 * A STEP file as a part (F2.1): an empty part with the file imported as 「輸入1」. It is exactly what
 * 「開啟舊檔」 makes of the file (the same ids, so the same persistent names): a component that uses the
 * STEP file keeps its mates when the file is later saved as a part and the component points to that.
 */
export async function stepAsPart(bytes: Uint8Array, fileName: string): Promise<PartFile> {
  const sha256 = await sha256Hex(bytes);
  const doc = applyCommand(createEmptyPart(), {
    type: 'importBody',
    blob: { id: 'blob1', sha256, kind: 'step', fileName },
    feature: { id: 'import1', type: 'importedBody', name: '輸入1', suppressed: false, blob: 'blob1' },
    index: 0,
  });
  return { doc, blobs: new Map([[sha256, bytes]]), format: '3dbx', warnings: [] };
}

/** A file a component uses (C15.1): a part file, or a STEP file taken as a part. */
export function readComponentFile(bytes: Uint8Array, fileName: string): Promise<PartFile> {
  return isStepData(bytes) ? stepAsPart(bytes, fileName) : readPartFile(bytes);
}
