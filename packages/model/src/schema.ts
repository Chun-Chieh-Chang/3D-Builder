import type { Id } from './ids';

/**
 * SSOT document schema (B1, B2, B5, B8, B9).
 * Only design intent lives here. B-Rep, meshes, element maps, sketch solutions,
 * DOF status, mass properties and error lists are derived data and never stored.
 */

export const SCHEMA_VERSION = 6;

/** Value expression: "20", "25.4mm", "1in", "30deg". Variables/equations arrive in Phase 3a (B5.2/B5.3). */
export type Expr = string;

export type Vec3 = [number, number, number];

/** Geometric fallback used to disambiguate or repair a persistent-name reference (B4.3). */
export interface Fingerprint {
  /** Surface type for faces ("plane", "cylinder", …) or curve type for edges ("line", "circle", …). */
  type: string;
  /** Area for faces, length for edges. */
  size: number;
  center: Vec3;
  /** Plane normal for planar faces, direction for straight edges. */
  dir?: Vec3;
}

/** Reference = persistent name + fingerprint. Never a topology index (H3). */
export interface Ref {
  kind: 'face' | 'edge' | 'vertex' | 'datum' | 'body';
  name: string;
  fingerprint?: Fingerprint;
}

export type DatumPlaneName = 'plane:front' | 'plane:top' | 'plane:right';

// ---------------------------------------------------------------- sketch (C1)

/** Reserved id of the projected part origin inside every sketch (fixed at 0,0). */
export const SKETCH_ORIGIN: Id = '@origin';

export type SketchEntity =
  | { id: Id; type: 'point'; x: number; y: number; construction?: boolean }
  | { id: Id; type: 'line'; p1: Id; p2: Id; construction?: boolean }
  | { id: Id; type: 'circle'; center: Id; radius: number; construction?: boolean }
  | { id: Id; type: 'arc'; center: Id; start: Id; end: Id; construction?: boolean };

/**
 * Sketch relations and dimensions (C1.25–C1.28). Point coordinates stored on entities are the
 * initial guess and the intent for under-defined DOFs; solved positions are derived.
 */
export type SketchConstraint =
  | { id: Id; type: 'coincident'; a: Id; b: Id }
  /** One line, or two points aligned horizontally / vertically. */
  | { id: Id; type: 'horizontal'; a: Id; b?: Id }
  | { id: Id; type: 'vertical'; a: Id; b?: Id }
  | { id: Id; type: 'collinear'; a: Id; b: Id }
  | { id: Id; type: 'parallel'; a: Id; b: Id }
  | { id: Id; type: 'perpendicular'; a: Id; b: Id }
  | { id: Id; type: 'tangent'; a: Id; b: Id }
  | { id: Id; type: 'concentric'; a: Id; b: Id }
  | { id: Id; type: 'equal'; a: Id; b: Id }
  | { id: Id; type: 'midpoint'; point: Id; line: Id }
  /** SolidWorks "coincident" between a point and a line, circle or arc (point–point is `coincident`). */
  | { id: Id; type: 'pointOnCurve'; point: Id; curve: Id }
  | { id: Id; type: 'symmetric'; a: Id; b: Id; axis: Id }
  | { id: Id; type: 'fix'; point: Id }
  | { id: Id; type: 'distance'; a: Id; b?: Id; value: Expr; label?: string; driving?: boolean }
  | { id: Id; type: 'distanceX'; a: Id; b: Id; value: Expr; label?: string; driving?: boolean }
  | { id: Id; type: 'distanceY'; a: Id; b: Id; value: Expr; label?: string; driving?: boolean }
  | { id: Id; type: 'radius'; circle: Id; value: Expr; label?: string; driving?: boolean }
  | { id: Id; type: 'diameter'; circle: Id; value: Expr; label?: string; driving?: boolean }
  /**
   * The angle of the sector between two lines where the dimension was placed (SolidWorks). The sector
   * lies between the rays along the lines as drawn, each reversed where `flip` says so; seen from the
   * intersection, `b`'s ray is `value` counter-clockwise from `a`'s. Without `flip` (and in documents
   * before v6) the rays are the lines as drawn.
   */
  | { id: Id; type: 'angle'; a: Id; b: Id; value: Expr; label?: string; driving?: boolean; flip?: 'a' | 'b' | 'both' };

export type DimensionConstraint = Extract<SketchConstraint, { value: Expr }>;

export function isDimension(c: SketchConstraint): c is DimensionConstraint {
  return 'value' in c;
}

// ---------------------------------------------------------------- features (C3–C5)

interface FeatureBase {
  id: Id;
  name: string;
  suppressed: boolean;
}

export interface SketchFeature extends FeatureBase {
  type: 'sketch';
  plane: Ref;
  entities: SketchEntity[];
  constraints: SketchConstraint[];
}

/**
 * Extrude end conditions (C4.1). The direction is the sketch normal for a boss and the opposite
 * (into the material) for a cut, as in SolidWorks; `reverse` flips it.
 */
export type EndCondition =
  | { type: 'blind'; depth: Expr; reverse?: boolean }
  | { type: 'midPlane'; depth: Expr }
  | { type: 'throughAll'; reverse?: boolean }
  | { type: 'upToFace'; face: Ref; reverse?: boolean };

export interface ExtrudeFeature extends FeatureBase {
  type: 'extrude';
  sketch: Id;
  op: 'boss' | 'cut';
  dir1: EndCondition;
  /** Second direction (P1). */
  dir2?: EndCondition;
}

/** Revolve end conditions (C4.3): an angle in one direction, or split evenly about the sketch plane. */
export type RevolveCondition = { type: 'blind'; angle: Expr; reverse?: boolean } | { type: 'midPlane'; angle: Expr };

export interface RevolveFeature extends FeatureBase {
  type: 'revolve';
  sketch: Id;
  /** A line of the same sketch, usually a centerline, to revolve about. */
  axis: Id;
  op: 'boss' | 'cut';
  dir1: RevolveCondition;
}

export interface FilletFeature extends FeatureBase {
  type: 'fillet';
  edges: Ref[];
  radius: Expr;
}

/** Chamfer (C5.3): SolidWorks 「角度-距離」 or 「距離-距離」. */
export interface ChamferFeature extends FeatureBase {
  type: 'chamfer';
  edges: Ref[];
  mode: 'angleDistance' | 'distanceDistance';
  /** Measured on the first adjacent face of each edge (see `flip`). */
  distance: Expr;
  /** The second distance, or the angle for angleDistance. */
  second: Expr;
  /** Measure `distance` on the other adjacent face of each edge (「反轉方向」). */
  flip?: boolean;
}

/**
 * How a reference plane is defined (C3.2). `plane` is a default plane or another reference plane
 * (kind "datum", by name or feature id) or a planar model face; `axis` a straight model edge;
 * `points` three model vertices.
 */
export type PlaneDefinition =
  | { mode: 'offset'; plane: Ref; distance: Expr; reverse?: boolean }
  /** Through the axis, turned by `angle` from the plane (at 0° parallel to it). */
  | { mode: 'angle'; plane: Ref; axis: Ref; angle: Expr; reverse?: boolean }
  | { mode: 'threePoint'; points: Ref[]; reverse?: boolean };

export interface RefPlaneFeature extends FeatureBase {
  type: 'refPlane';
  def: PlaneDefinition;
}

/**
 * A solid read from a file (F2.1). The file's content is the document's blob `blob` and travels
 * inside the part file, so the part rebuilds without the original file.
 */
export interface ImportedBodyFeature extends FeatureBase {
  type: 'importedBody';
  blob: Id;
}

export type Feature = SketchFeature | ExtrudeFeature | RevolveFeature | FilletFeature | ChamferFeature | RefPlaneFeature | ImportedBodyFeature;
export type FeatureType = Feature['type'];

// ---------------------------------------------------------------- document

export interface Variable {
  id: Id;
  name: string;
  expr: Expr;
}

export interface AppearanceOverride {
  target: Ref | { kind: 'part' };
  color: string;
}

/** Data a feature imports, identified by content (the part file stores it as blobs/<sha256>.<kind>). */
export interface BlobRef {
  id: Id;
  sha256: string;
  kind: 'step';
  /** Name of the file it was read from; shown only. */
  fileName?: string;
}

export interface PartDoc {
  kind: 'part';
  schemaVersion: number;
  displayUnits: { length: 'mm' | 'in'; angle: 'deg' };
  variables: Variable[];
  /** Ordered history = FeatureManager tree order (B2.1). */
  features: Feature[];
  /** Rollback bar position: number of features evaluated, or null for all (B2.4). */
  rollbackIndex: number | null;
  properties: Record<string, string>;
  appearances: AppearanceOverride[];
  blobs: BlobRef[];
  /**
   * Highest number issued so far per readable-id prefix ("l" → 4 means l1…l4 were issued).
   * Ids are never reused, so a stale reference can never silently bind to a new object (B1.3).
   */
  idCounters: Record<string, number>;
}

export function findFeature(doc: PartDoc, id: Id): Feature | undefined {
  return doc.features.find((f) => f.id === id);
}

// ---------------------------------------------------------------- assembly (C15, A3.1, B9.4)

/** Assemblies have their own version line: a part and an assembly change for different reasons. */
export const ASSEMBLY_SCHEMA_VERSION = 1;

/** Unit quaternion [x, y, z, w]. */
export type Quat = [number, number, number, number];

/**
 * Where a component sits (A3.1): its part's origin at `position` (mm), its axes turned by `rotation`.
 * For a floating component this is where the user put it: the start and the intent for whatever its
 * mates leave free (2B). Solved positions are derived and never stored.
 */
export interface Pose {
  position: Vec3;
  rotation: Quat;
}

/**
 * A file the assembly uses (B9.4), by its path relative to the assembly file's folder, "/" separated
 * ("定位板.3dbx", "零件/削邊銷.3dbx", "../共用/銷.3dbx"). Every component of the file refers to this
 * one entry, so the path is stored once.
 */
export interface FileRef {
  id: Id;
  path: string;
}

export interface Component {
  id: Id;
  /** The part file: a FileRef of the assembly. Several components may use one file (C15.1). */
  file: Id;
  /** SolidWorks' instance number, 「削邊銷<2>」: unique among the components of one file. */
  instance: number;
  /** A fixed component never moves (C15.2); a floating one is placed by the user and, from 2B, by its mates. */
  fixed: boolean;
  placement: Pose;
}

export interface AssemblyDoc {
  kind: 'assembly';
  schemaVersion: number;
  files: FileRef[];
  /** FeatureManager order. */
  components: Component[];
  properties: Record<string, string>;
  /** As in parts (B1.3): ids are never reused. */
  idCounters: Record<string, number>;
}
