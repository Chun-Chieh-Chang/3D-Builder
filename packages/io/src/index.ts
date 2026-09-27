import type { PartDoc } from '@3db/model';
import type { Kernel, ShapeId } from '@3db/kernel';

/** Product name written into STEP (F1.1): the part-name property, else a neutral default. */
export function productName(doc: PartDoc): string {
  return doc.properties['零件名稱']?.trim() || doc.properties['name']?.trim() || 'Part';
}

/** STEP AP214 export of a part body (F1.1). Names/colors via XCAF arrive with F1.3 in Phase 1. */
export function exportPartStep(kernel: Kernel, body: ShapeId, doc: PartDoc): string {
  return kernel.exportStep(body, productName(doc));
}

export function stepFileName(doc: PartDoc): string {
  const safe = productName(doc).replace(/[\\/:*?"<>|]+/g, '_');
  return `${safe}.step`;
}
