import { applyCommand, createEmptyPart, type ImportedBodyFeature } from '@3db/model';
import { sha256Hex } from '@3db/io';
import type { PlaneGcsSolver } from '@3db/sketch';
import type { Kernel, ShapeId } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';

/**
 * A shape written as STEP and read back as an imported body, as a part of its own: what a part sent to another program and returned comes to (hardening H-5: the way real files come in is
 * the one thing the random parts can test of interchange until there are samples). The regenerator is given to `keep`, for the test to dispose of.
 */
export async function viaStep(kernel: Kernel, solver: PlaneGcsSolver, shape: ShapeId, keep: (r: Regenerator) => void): Promise<RebuildResult> {
  const bytes = new TextEncoder().encode(kernel.exportStep(shape, 'part'));
  const sha = await sha256Hex(bytes);
  const feature: ImportedBodyFeature = { id: 'imp1', type: 'importedBody', name: '輸入1', suppressed: false, blob: 'blob1' };
  const doc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'part.step' }, feature, index: 0 });
  const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
  keep(regen);
  return regen.rebuild(doc);
}
