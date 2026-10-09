import type { Locale } from '@3db/i18n';
import type { InterferenceComponent, MeasureReport, MeasureTarget, PartMass, ElementFacts, ViewAxes, ViewFeature } from '@3db/model';
import type { AssemblyDoc, Axis3, CoordSystem, Fingerprint, Id, PartDoc, PlaneFrame, Pose, Ref, SketchFeature, SourceTree, Vec3 } from '@3db/model';
import type { DraftReport, ThicknessReport, UndercutReport, GeometryReport, MassProps, MeshData, ProjectedView } from '@3db/kernel';
import type { AssemblyResult, AssemblySolveOptions, ClearanceRow, Converted, FeatureResult, FlatReport, SheetCheck, SheetCheckLimits, SweepResult } from '@3db/regen';
import type { MateGeometry } from '@3db/assembly';
import type { StepAssemblyPlan, StepInstance, StepSub } from '@3db/io';
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

/** A part file a derived body reads (C7.5), read by the app from the project folder, with the files it reads in turn. */
export interface SourceFileData {
  /** The path as the derived body writes it (relative to the file that reads it). */
  ref: string;
  /** The file in the project folder: what tells a cycle. */
  path: string;
  bytes: Uint8Array;
  sources?: SourceFileData[];
}

export interface RebuildRequest {
  seq: number;
  doc: PartDoc;
  /** The master files of the document's derived bodies (C7.5); absent when it has none. */
  sources?: SourceFileData[];
  /** Edit sessions evaluate features [0, until). */
  until?: number;
}

/** A body of the part (C7.1) as the FeatureManager shows it: derived from the features, with what the document says of it. */
export interface BodyPayload {
  id: Id;
  name: string;
  reference: boolean;
  /** A surface body (4b): no solid, not a part. */
  surface: boolean;
  /** Whether it is drawn (D4.6): a hidden body has no faces in mesh, so it cannot be picked either. */
  shown: boolean;
  /** Its faces are numbers face0 … face0 + faces - 1 of the names and fingerprints below. */
  face0: number;
  faces: number;
  volume: number;
}

/** Everything the UI needs from one rebuild; all derived data (never written back into the document). */
/** A STEP file and what was said about writing it (4b-5): a shape written as it is when it could not be made portable. */
export interface StepOutput {
  text: string;
  warnings: string[];
}

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
  /** Built coordinate systems exposed to measurement in the assembly. */
  systems: { id: Id; name: string; system: CoordSystem }[];
  /** Every body it has is a reference body (C7.1): a design aid, not a part to count (C15.16). */
  referenceOnly: boolean;
  /** The part file's properties (B8.3): the parts list reads the vendor and the part number from them (C15.16). */
  properties: Record<string, string>;
  /** Its mass properties (E1.2): the bodies that count, for a density of one, and the density of its material in g/cm³ (null: none chosen). Null when it has no body. */
  mass: PartMass | null;
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

/** What interference found (E2.1): where components share volume (each overlap meshed, in the assembly's frame), and what could not be compared. */
export interface InterferenceResult {
  overlaps: { a: string; b: string; volume: number; mesh: MeshData }[];
  /** Pairs of parts the kernel was asked about. */
  checked: number;
  /** Components with a part that is not built. */
  unknown: string[];
  failed: { a: string; b: string; message: string }[];
  ms: number;
}

/** What the clearance check found (E2.2): the pairs of components closer than the least clearance asked for, the closest first. */
export interface ClearanceResult {
  rows: ClearanceRow[];
  checked: number;
  unknown: string[];
  failed: { a: string; b: string; message: string }[];
  ms: number;
}

/** Room to take a component out (E2.2): see `sweepClearance`. */
export interface SweepOutcome extends SweepResult {
  ms: number;
}

/** What a component that moves runs into (A3.6): the pairs of components that share volume, one of them a component that moves. */
export interface CollisionResult {
  pairs: { a: string; b: string }[];
  ms: number;
}

/** A view of a drawing asked for (C16.2): the parts it shows, as built for the app (by key), where each is, and the direction it is seen from. */
export interface DrawingViewRequest {
  parts: { part: string; mirrored: boolean; pose: Pose }[];
  /** Where it is seen from: the direction it looks along and the sheet's up. */
  axes: ViewAxes;
  /** A section (C16.3): the plane that cuts it, its normal toward the viewer (the side taken away). */
  cut?: { origin: [number, number, number]; normal: [number, number, number] };
  /** Also where each part is in the view (C16.6): what the balloons of an assembly drawing point at. */
  anchors?: boolean;
  /** The flat pattern of the (first) part, not a projection of it (S-1): its outline and bend lines. */
  flat?: boolean;
}

/** What a view of a drawing looks like: its lines at full size, or why they could not be made. */
export type DrawingViewResult = { lines: ProjectedView; /** Where each part is, in the order asked, when asked for. */ anchors?: [number, number][]; ms: number } | { error: string };

/** What a view of a drawing can be dimensioned from, or why not (C16.4). */
export type DrawingFeaturesResult = { features: ViewFeature[] } | { error: string };

/** What the elements a drawing's dimensions point at are, one for each reference asked, or why one could not be told (it is gone, or not something to dimension). */
export type DrawingElementsResult = { elements: (ElementFacts | { error: string })[] } | { error: string };

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
  /** The model's edges lying in a sketch's plane, projected (what the sketch can snap to); the model before the sketch, as the last rebuild left it. */
  sketchSnapItems(sketchId: Id): Promise<Converted[]>;
  /** STEP of the rebuilt part, its product named `name`. */
  exportStep(doc: PartDoc, name: string, options?: PartExportOptions): Promise<StepOutput>;
  /** Binary STL of the bodies that count, meshed as finely as the document's quality says (F4.1). */
  exportStl(doc: PartDoc, name: string, options?: PartExportOptions): Promise<Uint8Array>;
  /** Rebuilds a part file of an assembly, once per content (`key` = SHA-256 of `bytes`). */
  buildPart(key: string, bytes: Uint8Array, onStage?: (stage: PartStage) => void, sources?: SourceFileData[]): Promise<PartBuildPayload>;
  /** STEP of an assembly (F1.2) as the components are placed in `req`; parts are the ones rebuilt for it (`buildPart`). */
  exportAssemblyStep(req: AssemblyStepRequest): Promise<StepOutput>;
  /**
   * The mirror of a part already built (C15.13): its shape mirrored in its own x = 0 plane, meshed. key is the mirror's (mirrorKey);
   * only the mesh is given, a derived copy has no elements to pick. Null when the part has no body or is not built.
   */
  buildMirrorPart(partKey: string): Promise<PartBuildPayload | null>;
  /** The structure of an assembly STEP (F2.8): its products, and each part's shape written as a STEP file of its own. Refuses, saying why, what cannot be used. */
  readStepAssembly(bytes: Uint8Array): Promise<StepAssemblyPlan>;
  /** Measures one or two elements (E1.1): of the part that is open (part null in the targets) or of parts as the assembly places them; see measureTargets. */
  measure(targets: MeasureTarget[]): Promise<MeasureReport>;
  /** The interference of components (E2.1): the volume their parts share, each overlap as a mesh. Parts are the ones rebuilt for the assembly (buildPart). */
  interference(components: InterferenceComponent[]): Promise<InterferenceResult>;
  /** The lines of the views of a drawing (C16.2, A4.4): exact hidden-line removal on parts built for the app (`buildPart`); one result for each request. */
  drawingViews(requests: DrawingViewRequest[]): Promise<DrawingViewResult[]>;
  /** What each view can be dimensioned from (C16.4): the planes it sees edge-on and the cylinders it sees as circles, of the part built for the app. */
  drawingFeatures(requests: { part: string; axes: ViewAxes }[]): Promise<DrawingFeaturesResult[]>;
  /** What the elements of a part that dimensions point at are (C16.4), by persistent name. */
  drawingElements(requests: { part: string; refs: Ref[] }[]): Promise<DrawingElementsResult[]>;
  /** The clearance between components (E2.2): the pairs closer than `least` mm, the closest first; with `only`, just those with one of these components. */
  clearance(components: InterferenceComponent[], least: number, only?: string[]): Promise<ClearanceResult>;
  /** How far `mover` can move along `dir` before it meets another component, at most `length` mm (E2.2). */
  sweep(components: InterferenceComponent[], mover: string, dir: Vec3, length: number): Promise<SweepOutcome>;
  /** The collisions of the components that move (A3.6): the pairs with a part that shares volume. */
  collisions(components: InterferenceComponent[], movers: string[]): Promise<CollisionResult>;
  /** The geometry check (E3.1) of parts: each by its key as built for the assembly, or the open part for null. Null for one that has no body or is not built. */
  checkGeometry(parts: (string | null)[]): Promise<(GeometryReport | null)[]>;
  /** The draft of every face of the part as it is shown to a mold that opens along `pull` (E3.2); `required` is the angle in radians. */
  analyzeDraft(pull: [number, number, number], required: number): Promise<DraftReport>;
  /** What of every face of the part as it is shown a mold that opens along `pull` can see from either end (E3.3). */
  analyzeUndercut(pull: [number, number, number]): Promise<UndercutReport>;
  /** How thick the wall is at every face of the part as it is shown, and which faces are under `min` or over `max` mm (E3.5). */
  analyzeThickness(limits: { min?: number; max?: number }): Promise<ThicknessReport>;
  /**
   * The flat pattern of the sheet metal part as it is shown (its outline, bend lines and sizes, C11.3) and its manufacturability checks against the limits given (ADR 0090); the
   * pattern is made once for both. `report` is null, and `error` says why, when the pattern cannot be made; the checks are still those that need no pattern.
   */
  flatPattern(limits: SheetCheckLimits): Promise<{ report: FlatReport | null; mesh: MeshData | null; error: string | null; checks: SheetCheck[] }>;
  /** Lets go of every rebuilt part file except these. */
  retainParts(keys: string[]): Promise<void>;
  /**
   * Solves an assembly's mates on the parts rebuilt for it (`trees`: component id → what the component is: a part by
   * its key, or a sub-assembly and what is in it, C15.4); with a goal, moves a component as far as its mates allow
   * (dragging, numeric moves).
   */
  solveAssembly(doc: AssemblyDoc, trees: Record<Id, SourceTree>, options?: AssemblySolveOptions): Promise<AssemblyResult>;
}
