import type { Kernel, ShapeId } from '@3db/kernel';

/** STEP AP214 export of a part body (F1.1), its product named after the part. Colors via XCAF arrive with F1.3. */
export function exportPartStep(kernel: Kernel, body: ShapeId, name: string): string {
  return kernel.exportStep(body, name);
}
