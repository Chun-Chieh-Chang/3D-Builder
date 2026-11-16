import { absorbedSketches, bodyFeature, type Feature, type PartDoc } from '@3db/model';
import type { RebuildResult } from '@3db/regen';
import type { PartBuildPayload } from './protocol';

/**
 * The features of a part as the assembly's FeatureManager lists them under its component (read only, in history order, as
 * SolidWorks shows a part expanded in an assembly): each one's name and type, and whether it is suppressed or failed in the part.
 */
export function partFeatures(doc: PartDoc, result: RebuildResult): PartBuildPayload['features'] {
  const status = new Map(result.features.map((f) => [f.id, f.status]));
  const sketches = new Map<string, string[]>();
  const sources = (f: Feature) => f.type === 'mirror' ? [...f.seeds, ...f.bodies.map((ref) => bodyFeature(ref.name))] : [];
  return doc.features.map((f) => {
    const inputs = [...new Set([...absorbedSketches(f), ...sources(f).flatMap((id) => sketches.get(id) ?? [])])];
    sketches.set(f.id, inputs);
    return {
      id: f.id, name: f.name, type: f.type,
      status: status.get(f.id) === 'error' ? 'error' : status.get(f.id) === 'suppressed' ? 'suppressed' : 'ok',
      ...(inputs.length ? { sketches: inputs } : {}),
    };
  });
}
