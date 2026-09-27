import type { Fingerprint, Id, PartDoc, SketchFeature } from '@3db/model';
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
  edgeNames: string[];
  edgeFingerprints: Fingerprint[];
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
  rebuild(req: RebuildRequest): Promise<RebuildPayload>;
  solveSketch(req: SketchSolveRequest): Promise<SketchSolvePayload>;
  exportStep(doc: PartDoc): Promise<string>;
}
