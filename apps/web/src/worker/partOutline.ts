import type { PartDoc } from '@3db/model';
import type { RebuildResult } from '@3db/regen';
import type { PartBuildPayload } from './protocol';

/**
 * The features of a part as the assembly's FeatureManager lists them under its component (read only, in history order, as
 * SolidWorks shows a part expanded in an assembly): each one's name and type, and whether it is suppressed or failed in the part.
 */
export function partFeatures(doc: PartDoc, result: RebuildResult): PartBuildPayload['features'] {
  const status = new Map(result.features.map((f) => [f.id, f.status]));
  return doc.features.map((f) => ({ id: f.id, name: f.name, type: f.type, status: status.get(f.id) === 'error' ? 'error' : status.get(f.id) === 'suppressed' ? 'suppressed' : 'ok' }));
}
