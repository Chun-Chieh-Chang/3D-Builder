import type { Locale } from '@3db/i18n';
import type { AssemblyDoc, Axis3, CoordSystem, Fingerprint, Id, PartDoc, PlaneFrame, Pose, Ref, SketchFeature, SourceTree, Vec3 } from '@3db/model';
import type { MassProps, MeshData } from '@3db/kernel';
import type { AssemblyResult, AssemblySolveOptions, Converted, FeatureResult } from '@3db/regen';
import type { MateGeometry } from '@3db/assembly';
import type { StepInstance, StepSub } from '@3db/io';
import type { EntityStatus, SketchStatus, SolvedGeometry, SolveOptions } from '@3db/sketch';

/**
 * Where a part file is on its way in (2F): read from the project folder (the app), then rebuilt (a STEP
 * file is imported and named here, the longest stage), then meshed. Reported only while the worker
 * really does the work: a part it already has is answered at once, without any.
 */
export type PartStage = 'reading' | 'building' | 'meshing';

/** An assembly to write as STEP: the rebuilt parts it uses (by content key, named after their files) and where each component is. */
export interface AssemblyStepRequest {
  name: string;
  parts: { key: string; name: string }[];
  /** Sub-assemblies (C15.4), each once, in the order a later one may use the earlier ones. */
  subs: StepSub[];
  instances: StepInstance[];
}

/** What the user chose for a part's file (F1.3, C3.4): the STEP schema, whether faces carry their colors, and a coordinate system the part is written in. */
export interface PartExportOptions {
  schema?: 'AP214' | 'AP242';
  /** Colors in the file; on unless `false`. */
  colors?: boolean;
  /** A coordinate system feature: the part is moved so that its origin and axes are the file's. Absent: the part's own. */
  coordSys?: Id | null;
}

export interface RebuildRequest {
  seq: number;
  doc: PartDoc;
  /** Edit sessions evaluate features [0, until). */
  until?: number;
}

/** A body of the part (C7.1) as the FeatureManager shows it: derived from the features, with what the document says of it. */
export interface BodyPayload {
  id: Id;
  name: string;
  reference: boolean;
  /** Whether it is drawn (D4.6): a hidden body has no faces in mesh, so it cannot be picked either. */
  shown: boolean;
  /** Its faces are numbers ace0 … ace0 + faces - 1 of the names and fingerprints below. */
  face0: number;
  faces: number;
  volume: number;
}

/** Everything the UI needs from one rebuild; all derived data (never written back into the document). */
export interface RebuildPayload {
  seq: number;
  features: FeatureResult[];
  bodies: BodyPayload[];
  mesh: MeshData | null;
  faceNames: string[];
  faceFingerprints: Fingerprint[];
  edgeNames: string[];
  edgeFingerprints: Fingerprint[];
  vertexNames: string[];
  /** xyz per vertex, in the order of vertexNames. */
  vertexPoints: Float32Array;
  vertexFingerprints: Fingerprint[];
  /** The color of each face, "#rrggbb" or null, in the order of faceNames (C14.2). */
  faceColors: (string | null)[];
  /** Plane of each sketch (datum or model face), including the sketch being edited, and of each reference plane. */
  frames: Map<Id, PlaneFrame>;
  /** The reference axes, points and coordinate systems that were built (C3.3–C3.5). */
  axes: Map<Id, Axis3>;
  points: Map<Id, Vec3>;
  systems: Map<Id, CoordSystem>;
  /**
   * Solved geometry of every sketch that was evaluated. Which of them are drawn is the document's choice
   * (D4.6, `isShown`), so hiding or showing one does not need a rebuild.
   */
  sketchGeometry: Map<Id, Map<Id, SolvedGeometry>>;
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

/** Edges (and faces, by their outlines) of the model to turn into sketch entities, or into pierce points (C1.18, C1.26). */
export interface ConvertRequest {
  sketchId: Id;
  edges: Ref[];
  faces: Ref[];
  mode: 'convert' | 'pierce';
}

export interface ConvertPayload {
  items: Converted[];
  /** Why the others could not be converted. */
  errors: string[];
}

export interface KernelApi {
  init(): Promise<{ occtMs: number; gcsMs: number }>;
  /** The language of the messages the worker makes (errors, warnings); what it made before keeps its language. */
  setLocale(locale: Locale): Promise<void>;
  /** Imported data by SHA-256 (F2.1): the whole set when a part is loaded, one more on each import. */
  setBlobs(blobs: Map<string, Uint8Array>): Promise<void>;
  addBlob(sha256: string, data: Uint8Array): Promise<void>;
  rebuild(req: RebuildRequest): Promise<RebuildPayload>;
  solveSketch(req: SketchSolveRequest): Promise<SketchSolvePayload>;
  /** What these model edges and face outlines look like on the plane of the sketch being edited. */
  convertReferences(req: ConvertRequest): Promise<ConvertPayload>;
  /** STEP of the rebuilt part, its product named `name`. */
  exportStep(doc: PartDoc, name: string, options?: PartExportOptions): Promise<string>;
  /** Binary STL of the bodies that count, meshed as finely as the document's quality says (F4.1). */
  exportStl(doc: PartDoc, name: string, options?: PartExportOptions): Promise<Uint8Array>;
  /** Rebuilds a part file of an assembly, once per content (`key` = SHA-256 of `bytes`). */
  buildPart(key: string, bytes: Uint8Array, onStage?: (stage: PartStage) => void): Promise<PartBuildPayload>;
  /** STEP of an assembly (F1.2) as the components are placed in `req`; parts are the ones rebuilt for it (`buildPart`). */
  exportAssemblyStep(req: AssemblyStepRequest): Promise<string>;
  /** Lets go of every rebuilt part file except these. */
  retainParts(keys: string[]): Promise<void>;
  /**
   * Solves an assembly's mates on the parts rebuilt for it (`trees`: component id → what the component is: a part by
   * its key, or a sub-assembly and what is in it, C15.4); with a goal, moves a component as far as its mates allow
   * (dragging, numeric moves).
   */
  solveAssembly(doc: AssemblyDoc, trees: Record<Id, SourceTree>, options?: AssemblySolveOptions): Promise<AssemblyResult>;
}
