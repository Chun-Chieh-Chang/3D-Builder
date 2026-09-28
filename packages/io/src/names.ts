import type { PartDoc } from '@3db/model';

/** Product name written into STEP (F1.1) and used for file names: the part-name property, else a neutral default. */
export function productName(doc: PartDoc): string {
  return doc.properties['零件名稱']?.trim() || doc.properties['name']?.trim() || 'Part';
}

export function stepFileName(doc: PartDoc): string {
  const safe = productName(doc).replace(/[\/:*?"<>|]+/g, '_');
  return `${safe}.step`;
}
