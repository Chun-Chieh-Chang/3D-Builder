import type { Fingerprint, Ref } from '@3db/model';
import { fingerprintDistance } from '@3db/naming';
import type { RebuildPayload } from '../worker/protocol';

export interface Substitute {
  name: string;
  fingerprint: Fingerprint;
  distance: number;
}

/**
 * The element of the model on screen whose fingerprint is closest to a reference that no longer
 * resolves (B4.3), or null when there is nothing to offer: the reference has no fingerprint, or the
 * model has no element of its kind. It is only ever offered, never applied by itself.
 */
export function nearestElement(ref: Ref, result: RebuildPayload | null): Substitute | null {
  if (!result || !ref.fingerprint) return null;
  const [names, fingerprints] =
    ref.kind === 'face' ? [result.faceNames, result.faceFingerprints] : ref.kind === 'edge' ? [result.edgeNames, result.edgeFingerprints] : ref.kind === 'vertex' ? [result.vertexNames, result.vertexFingerprints] : [[], []];
  let best: Substitute | null = null;
  names.forEach((name, i) => {
    if (name === ref.name) return;
    const distance = fingerprintDistance(ref.fingerprint!, fingerprints[i]!);
    if (!best || distance < best.distance) best = { name, fingerprint: fingerprints[i]!, distance };
  });
  return best;
}
