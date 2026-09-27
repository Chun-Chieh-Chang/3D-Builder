import type { Id } from './ids';

/**
 * SSOT document schema (B1, B2, B5, B8, B9).
 * Only design intent lives here. B-Rep, meshes, element maps, sketch solutions,
 * DOF status, mass properties and error lists are derived data and never stored.
 */

export const SCHEMA_VERSION = 3;

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
  | { id: Id; type: 'angle'; a: Id; b: Id; value: Expr; label?: string; driving?: boolean };

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

export type Feature = SketchFeature | ExtrudeFeature | RevolveFeature | FilletFeature | ChamferFeature;
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

export interface BlobRef {
  id: Id;
  sha256: string;
  kind: 'step';
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
