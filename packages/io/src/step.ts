import type { PartDoc } from '@3db/model';
import type { Kernel, ShapeId } from '@3db/kernel';
import { productName } from './names';

/** STEP AP214 export of a part body (F1.1). Names/colors via XCAF arrive with F1.3. */
export function exportPartStep(kernel: Kernel, body: ShapeId, doc: PartDoc): string {
  return kernel.exportStep(body, productName(doc));
}
