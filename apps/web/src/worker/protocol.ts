import type { Fingerprint, Id, PartDoc, PlaneFrame, SketchFeature } from '@3db/model';
import type { MassProps, MeshData } from '@3db/kernel';
import type { FeatureResult } from '@3db/regen';
import type { EntityStatus, SketchStatus, SolvedGeometry, SolveOptions } from '@3db/sketch';

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
  faceFingerprints: Fingerprint[];
  edgeNames: string[];
  edgeFingerprints: Fingerprint[];
  vertexNames: string[];
  /** xyz per vertex, in the order of vertexNames. */
  vertexPoints: Float32Array;
  vertexFingerprints: Fingerprint[];
  /** Plane of each sketch (datum or model face), including the sketch being edited, and of each reference plane. */
  frames: Map<Id, PlaneFrame>;
  mass: MassProps | null;
  totalMs: number;
}

/** Solving the sketch being edited, without rebuilding the model (like SolidWorks inside a sketch). */
export interface SketchSolveRequest extends SolveOptions {
  seq: number;
  sketch: SketchFeature;
}

export interface SketchSolvePayload {
  seq: number;
  geometry: Map<Id, SolvedGeometry>;
  status: SketchStatus;
  dof: number;
  conflicting: Id[];
  redundant: Id[];
  entityStatus?: Map<Id, EntityStatus>;
  /** Why the sketch cannot make a closed profile yet (open ends, branches); empty when it can. */
  problems: string[];
  message?: string;
  ms: number;
}

export interface KernelApi {
  init(): Promise<{ occtMs: number; gcsMs: number }>;
  /** Imported data by SHA-256 (F2.1): the whole set when a part is loaded, one more on each import. */
  setBlobs(blobs: Map<string, Uint8Array>): Promise<void>;
  addBlob(sha256: string, data: Uint8Array): Promise<void>;
  rebuild(req: RebuildRequest): Promise<RebuildPayload>;
  solveSketch(req: SketchSolveRequest): Promise<SketchSolvePayload>;
  exportStep(doc: PartDoc): Promise<string>;
}
