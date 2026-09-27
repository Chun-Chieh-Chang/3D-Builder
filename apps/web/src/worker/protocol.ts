import type { Fingerprint, PartDoc } from '@3db/model';
import type { MassProps, MeshData } from '@3db/kernel';
import type { FeatureResult } from '@3db/regen';

export interface RebuildRequest {
  seq: number;
  doc: PartDoc;
  /** Edit sessions evaluate features [0, until). */
  until?: number;
}

/** Everything the UI needs from one rebuild; all derived data (never written back into the document). */
export interface RebuildPayload {
  seq: number;
  features: FeatureResult[];
  mesh: MeshData | null;
  faceNames: string[];
  edgeNames: string[];
  edgeFingerprints: Fingerprint[];
  mass: MassProps | null;
  totalMs: number;
}

export interface KernelApi {
  init(): Promise<{ occtMs: number; gcsMs: number }>;
  rebuild(req: RebuildRequest): Promise<RebuildPayload>;
  exportStep(doc: PartDoc): Promise<string>;
}
