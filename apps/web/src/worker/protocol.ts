import type { AssemblyDoc, Fingerprint, Id, PartDoc, PlaneFrame, SketchFeature } from '@3db/model';
import type { MassProps, MeshData } from '@3db/kernel';
import type { AssemblyResult, FeatureResult } from '@3db/regen';
import type { MateGeometry } from '@3db/assembly';
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

/**
 * A part file rebuilt for an assembly (2A). The worker keeps the rebuilt model, keyed by the file's
 * content, for as long as the assembly uses it.
 */
export interface PartBuildPayload {
  /** SHA-256 of the part file's bytes. */
  key: string;
  mesh: MeshData | null;
  /** What went wrong inside the part: features that failed, imported data the file lacks. */
  problems: string[];
  // The part's elements in the mesh's order, for picking them on a component (2C): persistent names,
  // fingerprints, and the geometry a mate can use (null where it cannot).
  faceNames: string[];
  faceFingerprints: Fingerprint[];
  faceGeometry: (MateGeometry | null)[];
  edgeNames: string[];
  edgeFingerprints: Fingerprint[];
  edgeGeometry: (MateGeometry | null)[];
  vertexNames: string[];
  /** xyz per vertex, in the order of vertexNames. */
  vertexPoints: Float32Array;
  vertexFingerprints: Fingerprint[];
  /** The part's reference planes (its default planes are the same in every part). */
  planes: { id: Id; name: string; frame: PlaneFrame }[];
  ms: number;
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
  /** STEP of the rebuilt part, its product named `name`. */
  exportStep(doc: PartDoc, name: string): Promise<string>;
  /** Rebuilds a part file of an assembly, once per content (`key` = SHA-256 of `bytes`). */
  buildPart(key: string, bytes: Uint8Array): Promise<PartBuildPayload>;
  /** Lets go of every rebuilt part file except these. */
  retainParts(keys: string[]): Promise<void>;
  /** Solves an assembly's mates on the parts rebuilt for it (`keys`: component id → part key). */
  solveAssembly(doc: AssemblyDoc, keys: Record<Id, string>): Promise<AssemblyResult>;
}
