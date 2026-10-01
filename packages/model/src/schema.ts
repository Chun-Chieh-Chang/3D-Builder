import type { Id } from './ids';

/**
 * SSOT document schema (B1, B2, B5, B8, B9).
 * Only design intent lives here. B-Rep, meshes, element maps, sketch solutions,
 * DOF status, mass properties and error lists are derived data and never stored.
 */

export const SCHEMA_VERSION = 16;

/** Value expression (B5.2, B5.3): "20", "25.4mm", "30deg", "wall_t*2", "D1@草圖1/2", "property('厚度')"; see `expr/`. */
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

/**
 * A `ref` on a line, circle or arc makes it the projection of a model edge onto the sketch plane (C1.18, v13): where it lies comes from the
 * model, never from the sketch, so it follows the edge when the model changes. A `pierce` on a point makes it the place where a straight model
 * edge passes through the sketch plane (「貫穿」, C1.26). Their points keep their stored places only as a first guess; the model fixes them.
 */
export type SketchEntity =
  | { id: Id; type: 'point'; x: number; y: number; construction?: boolean; pierce?: Ref }
  | { id: Id; type: 'line'; p1: Id; p2: Id; construction?: boolean; ref?: Ref }
  | { id: Id; type: 'circle'; center: Id; radius: number; construction?: boolean; ref?: Ref }
  | { id: Id; type: 'arc'; center: Id; start: Id; end: Id; construction?: boolean; ref?: Ref };

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
  /** Two circles or arcs with the same center and the same radius (SolidWorks 「同心同徑」, v11). */
  | { id: Id; type: 'coradial'; a: Id; b: Id }
  | { id: Id; type: 'equal'; a: Id; b: Id }
  | { id: Id; type: 'midpoint'; point: Id; line: Id }
  /** SolidWorks "coincident" between a point and a line, circle or arc (point–point is `coincident`). */
  | { id: Id; type: 'pointOnCurve'; point: Id; curve: Id }
  | { id: Id; type: 'symmetric'; a: Id; b: Id; axis: Id }
  /** A point where two curves cross (SolidWorks 「交錯」, v11). */
  | { id: Id; type: 'intersection'; point: Id; a: Id; b: Id }
  | { id: Id; type: 'fix'; point: Id }
  | { id: Id; type: 'distance'; a: Id; b?: Id; value: Expr; label?: string; driving?: boolean }
  | { id: Id; type: 'distanceX'; a: Id; b: Id; value: Expr; label?: string; driving?: boolean }
  | { id: Id; type: 'distanceY'; a: Id; b: Id; value: Expr; label?: string; driving?: boolean }
  | { id: Id; type: 'radius'; circle: Id; value: Expr; label?: string; driving?: boolean }
  | { id: Id; type: 'diameter'; circle: Id; value: Expr; label?: string; driving?: boolean }
  /** The length of an arc (v11); `circle` is the arc. */
  | { id: Id; type: 'arcLength'; circle: Id; value: Expr; label?: string; driving?: boolean }
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
  | { type: 'upToFace'; face: Ref; reverse?: boolean }
  /** Up to the first face in the way (成形到下一面, v14); which face is worked out from the geometry at every rebuild. */
  | { type: 'upToNext'; reverse?: boolean }
  /** Up to the plane through a vertex, parallel to the sketch (成形至頂點, v14). */
  | { type: 'upToVertex'; vertex: Ref; reverse?: boolean }
  /** Up to the surface of another body, which it takes the shape of (成形至本體, v14); ody is a kind: 'body' reference. */
  | { type: 'upToBody'; body: Ref; reverse?: boolean }
  /** To offset short of a face parallel to the sketch, or beyond it with eyond (從曲面偏移, v14). */
  | { type: 'offsetFromFace'; face: Ref; offset: Expr; beyond?: boolean; reverse?: boolean };

/** The walls of an extrusion lean by ngle (拔模, v14): away from the profile, or towards it with inward. */
export interface Draft {
  angle: Expr;
  inward?: boolean;
}

/** A thin feature (薄件, v14): the profile's outline thickened instead of its inside filled, one way, both ways equally, or by two thicknesses. */
export interface Thin {
  mode: 'one' | 'mid' | 'two';
  thickness: Expr;
  /** The other side's thickness, for 	wo. */
  thickness2?: Expr;
  /** One side: the other way round (to the outside of a closed profile, or the other side of an open one). */
  reverse?: boolean;
}

export interface ExtrudeFeature extends FeatureBase {
  type: 'extrude';
  sketch: Id;
  op: 'boss' | 'cut';
  /** A boss only (C7.1): `false` makes it a body of its own; absent (the default) merges it with the bodies it touches. */
  merge?: boolean;
  /** Which contours of the sketch it uses (C1.34, v12): each is the entities that bound one region; absent means all of them. */
  contours?: Id[][];
  dir1: EndCondition;
  /** Second direction, from the sketch plane the other way (v14). */
  dir2?: EndCondition;
  /** Draft of the walls of each direction (v14); not with 兩側對稱. */
  draft1?: Draft;
  draft2?: Draft;
  thin?: Thin;
}

/** Revolve end conditions (C4.3): an angle in one direction, or split evenly about the sketch plane. */
export type RevolveCondition = { type: 'blind'; angle: Expr; reverse?: boolean } | { type: 'midPlane'; angle: Expr };

export interface RevolveFeature extends FeatureBase {
  type: 'revolve';
  sketch: Id;
  /** A line of the same sketch, usually a centerline, to revolve about. */
  axis: Id;
  op: 'boss' | 'cut';
  /** As for `ExtrudeFeature.merge`. */
  merge?: boolean;
  /** As for `ExtrudeFeature.contours`. */
  contours?: Id[][];
  dir1: RevolveCondition;
  thin?: Thin;
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
  /** As for `ExtrudeFeature.merge`: `false` keeps what is read a body (or bodies) of its own. */
  merge?: boolean;
  /**
   * How far apart (a length) the edges of two surfaces may be and still be joined, when the file has surfaces
   * and no solid and they are sewn into one (F2.2). Without it the program's own default is used.
   */
  sewTolerance?: Expr;
}

/**
 * Delete Face (C10.2): the faces go and their neighbours are extended until they meet, which is how a
 * hole or a fillet of an imported body is taken out (SolidWorks 「刪除面」 with 「刪除並修補」).
 */
export interface DeleteFaceFeature extends FeatureBase {
  type: 'deleteFace';
  faces: Ref[];
  /**
   * 「刪除鑽孔」: besides the faces picked, the faces that only they enclose (the bottom of a blind hole) go too.
   * Which they are is worked out from the model each time, so the intent is stored, not their names.
   */
  hole?: boolean;
}

/**
 * Move Face (C10.1): a planar face is pushed `distance` along its outward normal (negative: into the
 * material) and its neighbours follow (SolidWorks 「移動面」, 「偏移」).
 */
export interface MoveFaceFeature extends FeatureBase {
  type: 'moveFace';
  face: Ref;
  distance: Expr;
}

/**
 * Shell (薄殼, C5.4, v15): the body hollowed out to a wall of 	hickness, the picked aces taken away to open it; the wall grows inward, or
 * outward with outward.
 */
export interface ShellFeature extends FeatureBase {
  type: 'shell';
  faces: Ref[];
  thickness: Expr;
  outward?: boolean;
}

/**
 * Draft (拔模, C5.5, v16): the walls aces lean by ngle about the neutral plane 
eutral (a planar face of the body, or a plane), so that they
 * narrow away from it; everse leans them the other way (they widen away from it).
 */
export interface DraftFeature extends FeatureBase {
  type: 'draft';
  neutral: Ref;
  faces: Ref[];
  angle: Expr;
  reverse?: boolean;
}

/**
 * Combine (C7.2): bodies added together, subtracted from the first, or reduced to what they share. `main` and `tools`
 * refer to bodies (kind `body`, the name is the body's id); the result is the main body, the tools are used up.
 */
export interface CombineFeature extends FeatureBase {
  type: 'combine';
  op: 'add' | 'subtract' | 'common';
  main: Ref;
  tools: Ref[];
}

export type Feature =
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | FilletFeature
  | ChamferFeature
  | RefPlaneFeature
  | ImportedBodyFeature
  | DeleteFaceFeature
  | MoveFaceFeature
  | ShellFeature
  | DraftFeature
  | CombineFeature;
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

/**
 * What the user has said about a body (C7.1). Which bodies there are is derived (they come from the features); this is
 * kept by body id, so a body that has gone leaves an entry that does nothing.
 */
export interface BodyProps {
  name?: string;
  /** A reference body (the workpiece of a fixture): not counted in the mass or written to the part's STEP, not in a bill of materials. */
  reference?: boolean;
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
   * What the user chose to show or hide (D4.6), by feature id (sketches, reference planes), default
   * plane name ("plane:front" …) or "origin". Only choices are stored: an item without an entry is
   * shown or hidden by its default (see `isShown`). Like SolidWorks, it is saved with the part.
   */
  visibility: Record<string, boolean>;
  /** Names and reference flags of bodies, by body id (C7.1). Only what was chosen is stored. */
  bodies: Record<Id, BodyProps>;
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
export const ASSEMBLY_SCHEMA_VERSION = 2;

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

/** The standard mates of SolidWorks 2010 (C15.8). */
export type MateType = 'coincident' | 'parallel' | 'perpendicular' | 'tangent' | 'concentric' | 'lock' | 'distance' | 'angle';

/**
 * An element a mate uses: of a component, by the persistent name in its part (a face, edge or vertex;
 * a default or reference plane as kind "datum"; the part's origin as kind "datum", name "origin"),
 * or of the assembly itself (`component` null: its default planes and origin, which never move).
 */
export interface MateRef {
  component: Id | null;
  ref: Ref;
}

/**
 * A mate (C15.8, C15.12). Only the design intent is stored: which elements, which relation, which
 * way round. Whether it holds, and where it puts the components, is solved and derived (2B).
 */
export interface Mate {
  id: Id;
  /** 「重合1」, 「同軸心2」 … */
  name: string;
  type: MateType;
  a: MateRef;
  b: MateRef;
  /** b's normal or axis runs with a's (SolidWorks 「同向對齊」) or against it (「反向對齊」). */
  align?: 'aligned' | 'antiAligned';
  /** Distance (length) or angle, for distance and angle mates. */
  value?: Expr;
  /** The distance on the other side, or the other angle (「反轉尺寸」). */
  flip?: boolean;
  /** Lock: b's pose relative to a's, as it was when locked. */
  relative?: Pose;
  suppressed: boolean;
}

export interface AssemblyDoc {
  kind: 'assembly';
  schemaVersion: number;
  files: FileRef[];
  /** FeatureManager order. */
  components: Component[];
  /** The mates folder, in FeatureManager order: the order conflicts are judged in (A3.4). */
  mates: Mate[];
  properties: Record<string, string>;
  /** As in parts (B1.3): ids are never reused. */
  idCounters: Record<string, number>;
}
